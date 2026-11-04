import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import { isIP } from 'net';
import { RtpPacket, SrtpSession } from 'werift-rtp';
import { RtpConfig, SrtpConfig, TransportStream } from '../interfaces';
import {
  DEFAULT_FEC_GROUP_SIZE,
  DEFAULT_FEC_PAYLOAD_TYPE,
  DEFAULT_REDUNDANCY_LEVEL,
  DEFAULT_RED_PAYLOAD_TYPE,
  DEFAULT_RTP_PORT,
  DEFAULT_T140_PAYLOAD_TYPE,
  FEC_HEADER_SIZE,
  FEC_LEVEL_HEADER_SIZE,
  FEC_MAX_GROUP_SIZE,
  RED_MAX_BLOCK_LENGTH,
  RED_MAX_TIMESTAMP_OFFSET,
  RTP_CSRC_ENTRY_SIZE,
  RTP_HEADER_SIZE,
  RTP_MAX_SEQUENCE_NUMBER,
  SEND_INTERVAL_MS,
  SRTP_AEAD_SALT_SIZE,
  SRTP_MASTER_KEY_SIZE,
  SRTP_MASTER_SALT_SIZE,
} from '../utils/constants';
import { ErrorFactory } from '../utils/error-factory';
import { generateSecureSSRC } from '../utils/security';
import { buildRtpHeader, createRtpPacket, RtpHeaderFields } from './create-rtp-packet';
import { createT140Clock, T140Clock } from './t140-clock';

/** A T140block already sent as primary data, kept for redundancy (RFC 4103 §4.2). */
interface SentBlock {
  payload: Buffer;
  timestamp: number;
}

/** Redundancy history of one stream (one per `streamIdentifier`, so sources never mix). */
interface RedundancyHistory {
  blocks: SentBlock[];
  lastOptions?: Partial<RtpConfig>;
}

/** A packet waiting to be covered by the next FEC packet (RFC 5109). */
interface ProtectedPacket {
  packet: Buffer;
  sequenceNumber: number;
  timestamp: number;
}

const HOSTNAME_PATTERN =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const MAX_PAYLOAD_TYPE = 127;

function assertRange(name: string, value: number | undefined, min: number, max: number): void {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

/**
 * Sends T.140 text as RTP or SRTP (RFC 4103, https://www.rfc-editor.org/rfc/rfc4103).
 *
 * One instance is one text/t140 stream: a fixed SSRC, a 16-bit sequence
 * counter, and a 1000 Hz timestamp clock. Every sendText() call becomes one
 * packet. Optional redundancy (text/red, RFC 2198) and generic FEC (RFC 5109)
 * protect against packet loss.
 *
 * Events:
 * - 'error' (T140RtpError): network, encryption, FEC, configuration, or
 *   resource failures. The send path never throws.
 */
export class T140RtpTransport extends EventEmitter {
  private readonly config: RtpConfig;
  private readonly clock: T140Clock;
  private readonly remoteAddress: string;
  private readonly remotePort: number;
  private readonly udpSocket?: dgram.Socket;
  private readonly customTransport?: TransportStream;
  private srtpSession?: SrtpSession;
  private srtpRequired = false;
  private closed = false;
  private seqNum: number;
  /** FEC packets have their own sequence space (RFC 5109 §7.2). */
  private fecSeqNum: number;
  private fecGroup: ProtectedPacket[] = [];
  private redHistories: Map<string, RedundancyHistory> = new Map();
  private redDrainTimer: NodeJS.Timeout | null = null;

  constructor(
    remoteAddress: string,
    remotePort: number = DEFAULT_RTP_PORT,
    config: RtpConfig = {}
  ) {
    super();

    this.customTransport = config.customTransport;
    if (this.customTransport && typeof this.customTransport.send !== 'function') {
      throw new Error(
        'customTransport must implement send(data, callback). ' +
        'To reuse an existing T140RtpTransport, pass it as the existingTransport argument instead.'
      );
    }
    if (!this.customTransport) {
      if (!remoteAddress) {
        throw new Error('Remote address is required when no custom transport is provided');
      }
      if (isIP(remoteAddress) === 0 && !HOSTNAME_PATTERN.test(remoteAddress)) {
        throw new Error('Invalid remote address format');
      }
      assertRange('Port number', remotePort, 1, MAX_UINT16);
    }

    assertRange('payloadType', config.payloadType, 0, MAX_PAYLOAD_TYPE);
    assertRange('redPayloadType', config.redPayloadType, 0, MAX_PAYLOAD_TYPE);
    assertRange('fecPayloadType', config.fecPayloadType, 0, MAX_PAYLOAD_TYPE);
    assertRange('ssrc', config.ssrc, 0, MAX_UINT32);
    assertRange('initialSequenceNumber', config.initialSequenceNumber, 0, MAX_UINT16);
    assertRange('initialTimestamp', config.initialTimestamp, 0, MAX_UINT32);
    assertRange('fecGroupSize', config.fecGroupSize, 1, FEC_MAX_GROUP_SIZE);
    assertRange('redundancyLevel', config.redundancyLevel, 0, MAX_UINT16);

    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    this.config = {
      ...config,
      payloadType: config.payloadType ?? DEFAULT_T140_PAYLOAD_TYPE,
      ssrc: config.ssrc ?? generateSecureSSRC(),
      fecEnabled: config.fecEnabled ?? false,
      fecPayloadType: config.fecPayloadType ?? DEFAULT_FEC_PAYLOAD_TYPE,
      fecGroupSize: config.fecGroupSize ?? DEFAULT_FEC_GROUP_SIZE,
      redEnabled: config.redEnabled ?? true,
      redPayloadType: config.redPayloadType ?? DEFAULT_RED_PAYLOAD_TYPE,
      redundancyLevel: config.redundancyLevel ?? DEFAULT_REDUNDANCY_LEVEL,
    };
    this.seqNum = config.initialSequenceNumber ?? 0;
    this.fecSeqNum = this.seqNum;
    this.clock = createT140Clock(config.initialTimestamp ?? 0, config.timestampIncrement);

    if (!this.customTransport) {
      this.udpSocket = dgram.createSocket(isIP(remoteAddress) === 6 ? 'udp6' : 'udp4');
      this.udpSocket.on('error', (err) => {
        this.emit('error', ErrorFactory.NETWORK('UDP socket error', err));
      });
    }
  }

  /**
   * Enable SRTP (RFC 3711) for every packet sent after this call.
   *
   * Supply the keys yourself, or get them from a DTLS-SRTP handshake with
   * `negotiateDtlsSrtp` (RFC 5764), which is the automatic key management
   * RFC 3711 §9.1 requires.
   *
   * Throws on an unusable configuration instead of sending plaintext. Calling
   * it again on a transport that already has a session is a no-op, because
   * a new session would restart the rollover counter and repeat keystream.
   */
  setupSrtp(srtpConfig: SrtpConfig): void {
    if (this.srtpSession) return;
    this.srtpRequired = true;

    const profile = srtpConfig.profile ?? 0x0001; // SRTP_AES128_CM_HMAC_SHA1_80
    const saltSize = profile === 0x0007 ? SRTP_AEAD_SALT_SIZE : SRTP_MASTER_SALT_SIZE;
    const remoteMasterKey = srtpConfig.remoteMasterKey ?? srtpConfig.masterKey;
    const remoteMasterSalt = srtpConfig.remoteMasterSalt ?? srtpConfig.masterSalt;

    for (const [name, value, size] of [
      ['masterKey', srtpConfig.masterKey, SRTP_MASTER_KEY_SIZE],
      ['masterSalt', srtpConfig.masterSalt, saltSize],
      ['remoteMasterKey', remoteMasterKey, SRTP_MASTER_KEY_SIZE],
      ['remoteMasterSalt', remoteMasterSalt, saltSize],
    ] as [string, Buffer | undefined, number][]) {
      if (!Buffer.isBuffer(value)) {
        throw new Error(`SRTP ${name} must be a Buffer`);
      }
      if (value.length !== size) {
        throw new Error(`SRTP ${name} must be ${size} bytes for profile 0x${profile.toString(16).padStart(4, '0')}`);
      }
    }

    if (this.config.fecEnabled) {
      // FEC shares the media SSRC and would reuse SRTP keystream in one session
      // (RFC 5109 §14.1, RFC 3711 §9.1). Use redundancy instead.
      throw new Error('fecEnabled cannot be combined with SRTP; use redEnabled');
    }

    try {
      this.srtpSession = new SrtpSession({
        profile,
        keys: {
          remoteMasterKey,
          remoteMasterSalt,
          localMasterKey: srtpConfig.masterKey,
          localMasterSalt: srtpConfig.masterSalt,
        },
      });
    } catch (err) {
      throw new Error(`Failed to initialize SRTP session: ${(err as Error).message}`);
    }
  }

  /**
   * Send one T140block as one RTP packet (RFC 4103 §3).
   *
   * @param text UTF-8 text. Empty text sends an empty T140block (RFC 4103 §5.2).
   * @param options Per-packet overrides of the transport config, for example
   *   `markerBit` for the first packet after an idle period.
   */
  sendText(text: string, options?: Partial<RtpConfig>): void {
    if (this.closed) return;
    const opts = options ? { ...this.config, ...options } : this.config;

    const sequenceNumber = this.seqNum;
    this.seqNum = (this.seqNum + 1) % RTP_MAX_SEQUENCE_NUMBER;
    const timestamp = this.clock.next();

    const mediaPacket = createRtpPacket(sequenceNumber, timestamp, text, {
      payloadType: opts.payloadType,
      ssrc: opts.ssrc,
      markerBit: opts.markerBit,
      multiplexEnabled: opts.multiplexEnabled,
      streamIdentifier: opts.streamIdentifier,
      csrcList: opts.csrcList,
      useCsrcForStreamId: opts.useCsrcForStreamId,
    });

    let packet = mediaPacket;
    if (opts.redEnabled) {
      const headerLength = RTP_HEADER_SIZE + (opts.csrcList?.length ?? 0) * RTP_CSRC_ENTRY_SIZE;
      const primary = mediaPacket.subarray(headerLength);
      const history = this._redHistory(opts.streamIdentifier);
      history.lastOptions = options;
      packet = this._buildRedPacket(primary, history.blocks, {
        sequenceNumber,
        timestamp,
        marker: opts.markerBit === true,
        payloadType: opts.redPayloadType!,
        ssrc: opts.ssrc!,
        csrcList: opts.csrcList,
      }, opts.payloadType!, opts.redundancyLevel!);
      this._rememberForRedundancy(history, primary, timestamp, opts.redundancyLevel!);
      this._scheduleRedundancyDrain();
    }

    this._encryptAndSend(packet, 'RTP packet');

    if (opts.fecEnabled) {
      this.fecGroup.push({ packet, sequenceNumber, timestamp });
      if (this.fecGroup.length >= this.config.fecGroupSize!) {
        this._flushFecGroup();
      }
    }
  }

  /**
   * Close the transport. Sends any pending FEC packet first. Safe to call twice.
   */
  close(): void {
    if (this.closed) return;
    if (this.redDrainTimer) {
      clearTimeout(this.redDrainTimer);
      this.redDrainTimer = null;
    }
    try {
      this._flushFecGroup();
      this.closed = true;
      if (this.customTransport) {
        this.customTransport.close?.();
      } else {
        this.udpSocket?.close();
      }
    } catch (err) {
      this.emit('error', ErrorFactory.RESOURCE('Error closing transport resources', err as Error));
    }
  }

  private _redHistory(streamIdentifier?: string): RedundancyHistory {
    const key = streamIdentifier ?? '';
    let history = this.redHistories.get(key);
    if (!history) {
      history = { blocks: [] };
      this.redHistories.set(key, history);
    }
    return history;
  }

  /**
   * Build a text/red packet (RFC 2198 §3 as profiled by RFC 4103 §4).
   * https://www.rfc-editor.org/rfc/rfc2198#section-3
   *
   * Layout: RTP header, one 4-byte header per redundant block, a 1-byte header
   * for the primary block, the redundant T140blocks oldest first, then the
   * primary T140block.
   *
   *  0                   1                   2                   3
   *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
   * |1|   T140 PT   |  timestamp offset (14)    | block length (10) |
   * |0|   T140 PT   |
   */
  private _buildRedPacket(
    primary: Buffer,
    history: SentBlock[],
    header: RtpHeaderFields,
    t140PayloadType: number,
    redundancyLevel: number
  ): Buffer {
    // RFC 4103 §4.1: blocks that would need an offset above 16383 MUST NOT be sent.
    const blocks = history
      .slice(-redundancyLevel)
      .filter((block) => ((header.timestamp - block.timestamp) >>> 0) <= RED_MAX_TIMESTAMP_OFFSET);

    const blockHeaders = Buffer.alloc(blocks.length * 4 + 1);
    blocks.forEach((block, i) => {
      const timestampOffset = (header.timestamp - block.timestamp) >>> 0;
      const word =
        (1 << 31) | (t140PayloadType << 24) | (timestampOffset << 10) | block.payload.length;
      blockHeaders.writeUInt32BE(word >>> 0, i * 4);
    });
    blockHeaders[blocks.length * 4] = t140PayloadType; // F = 0: primary block follows

    return Buffer.concat([
      buildRtpHeader(header),
      blockHeaders,
      ...blocks.map((block) => block.payload),
      primary,
    ]);
  }

  private _rememberForRedundancy(
    history: RedundancyHistory,
    primary: Buffer,
    timestamp: number,
    redundancyLevel: number
  ): void {
    // A block longer than the 10-bit length field cannot be carried as redundant data.
    if (primary.length > RED_MAX_BLOCK_LENGTH) return;
    history.blocks.push({ timestamp, payload: Buffer.from(primary) });
    if (history.blocks.length > redundancyLevel) {
      history.blocks.shift();
    }
  }

  /**
   * RFC 4103 §5.2: when text stops, keep sending packets with an empty primary
   * T140block at every transmission interval until the last real block has gone
   * out with all its redundant generations. Without this the last characters
   * before an idle period are the only ones with no protection.
   */
  private _scheduleRedundancyDrain(): void {
    if (this.redDrainTimer) {
      clearTimeout(this.redDrainTimer);
    }
    this.redDrainTimer = setTimeout(() => {
      this.redDrainTimer = null;
      for (const history of this.redHistories.values()) {
        if (history.blocks.some((block) => block.payload.length > 0)) {
          this.sendText('', { ...history.lastOptions, markerBit: false });
        }
      }
    }, SEND_INTERVAL_MS);
    this.redDrainTimer.unref?.();
  }

  /**
   * Build one generic FEC packet over the pending group (RFC 5109 §7).
   * https://www.rfc-editor.org/rfc/rfc5109#section-7
   *
   * The FEC packet shares the media SSRC, keeps its own sequence counter, and
   * carries the 10-byte FEC header, the 4-byte level-0 header (protection
   * length + 16-bit mask, MSB = SN base), then the XOR of the protected
   * packets' bytes after the fixed RTP header. It goes to the same port as the
   * media, which RFC 5109 §14.1 says SHOULD be avoided; a receiver that does
   * not know the FEC payload type discards it.
   */
  private _flushFecGroup(): void {
    if (this.fecGroup.length === 0) return;
    const group = this.fecGroup;
    this.fecGroup = [];

    const rtpHeader = buildRtpHeader({
      marker: false,
      payloadType: this.config.fecPayloadType!,
      sequenceNumber: this.fecSeqNum,
      timestamp: this.clock.now(),
      ssrc: this.config.ssrc!,
    });
    this.fecSeqNum = (this.fecSeqNum + 1) % RTP_MAX_SEQUENCE_NUMBER;

    const protectionLength = Math.max(...group.map((p) => p.packet.length - RTP_HEADER_SIZE));
    const payload = Buffer.alloc(protectionLength);
    let flagsRecovery = 0;
    let markerAndPtRecovery = 0;
    let tsRecovery = 0;
    let lengthRecovery = 0;
    for (const { packet, timestamp } of group) {
      flagsRecovery ^= packet[0] & 0x3f; // P, X, CC
      markerAndPtRecovery ^= packet[1];  // M, PT
      tsRecovery ^= timestamp;
      lengthRecovery ^= packet.length - RTP_HEADER_SIZE;
      for (let i = RTP_HEADER_SIZE; i < packet.length; i += 1) {
        payload[i - RTP_HEADER_SIZE] ^= packet[i];
      }
    }

    const fecHeader = Buffer.alloc(FEC_HEADER_SIZE + FEC_LEVEL_HEADER_SIZE);
    fecHeader[0] = flagsRecovery; // E = 0, L = 0
    fecHeader[1] = markerAndPtRecovery;
    fecHeader.writeUInt16BE(group[0].sequenceNumber, 2); // SN base
    fecHeader.writeUInt32BE(tsRecovery >>> 0, 4);
    fecHeader.writeUInt16BE(lengthRecovery & MAX_UINT16, 8);
    fecHeader.writeUInt16BE(protectionLength, 10);
    fecHeader.writeUInt16BE((MAX_UINT16 << (16 - group.length)) & MAX_UINT16, 12);

    this._encryptAndSend(Buffer.concat([rtpHeader, fecHeader, payload]), 'FEC packet');
  }

  private _encryptAndSend(packet: Buffer, what: string): void {
    let wire = packet;
    if (this.srtpRequired) {
      if (!this.srtpSession) {
        this.emit('error', ErrorFactory.ENCRYPTION(`SRTP not ready - ${what} not sent`));
        return;
      }
      try {
        const rtp = RtpPacket.deSerialize(packet);
        wire = this.srtpSession.encrypt(rtp.payload, rtp.header);
      } catch (err) {
        // Never fall back to plaintext.
        this.emit('error', ErrorFactory.ENCRYPTION(
          `Failed to encrypt ${what} with SRTP - packet not sent`,
          err as Error
        ));
        return;
      }
    }

    const onSent = (err?: Error | null): void => {
      if (err) {
        this.emit('error', ErrorFactory.NETWORK(`Failed to send ${what}`, err));
      }
    };
    try {
      if (this.customTransport) {
        this.customTransport.send(wire, onSent);
      } else {
        this.udpSocket!.send(wire, 0, wire.length, this.remotePort, this.remoteAddress, onSent);
      }
    } catch (err) {
      // A transport that throws synchronously must not kill the process: this
      // runs from a drain timer.
      this.emit('error', ErrorFactory.NETWORK(`Failed to send ${what}`, err as Error));
    }
  }
}
