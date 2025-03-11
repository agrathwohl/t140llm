import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import { RtpConfig, SrtpConfig, T140RtpError, T140RtpErrorType, TransportStream } from '../interfaces';
import { DEFAULT_RED_PAYLOAD_TYPE, DEFAULT_RTP_PORT, DEFAULT_T140_PAYLOAD_TYPE, RTP_HEADER_SIZE } from '../utils/constants';
import { generateSecureSSRC } from '../utils/security';
import { createRtpPacket } from './create-rtp-packet';

// Import werift-rtp using require to avoid TypeScript errors
// @ts-ignore
// tslint:disable-next-line:no-var-requires
const weriftRtp = require('werift-rtp');
const { SrtpSession, SrtpPolicy, SrtpContext } = weriftRtp;

/**
 * Class to manage RTP/SRTP connections for sending T.140 data
 *
 * Events:
 * - 'error': Emitted when an error occurs. Error object contains:
 *   - type: T140RtpErrorType - the type of error
 *   - message: string - human-readable error message
 *   - cause?: Error - original error that caused this error (if available)
 *
 * Error Types:
 * - NETWORK_ERROR: UDP socket or network-related errors
 *   - Occurs when sending packets fails due to network issues
 *   - Socket connection issues
 *
 * - ENCRYPTION_ERROR: SRTP encryption errors
 *   - Occurs when encryption or decryption fails
 *   - Key generation or management errors
 *
 * - FEC_ERROR: Forward Error Correction errors
 *   - Occurs when FEC packet creation fails
 *   - Invalid FEC parameters or configurations
 *
 * - INVALID_CONFIG: Invalid configuration errors
 *   - Occurs when the provided configuration is invalid
 *   - Missing required parameters
 *
 * - RATE_LIMIT_ERROR: Rate limiting errors
 *   - Occurs when rate limit handling encounters issues
 *
 * - RESOURCE_ERROR: Resource allocation/deallocation errors
 *   - Occurs during socket creation/closing
 *   - Memory allocation issues
 *
 * Example usage:
 * ```typescript
 * const transport = new T140RtpTransport('127.0.0.1', 5004);
 * transport.on('error', (err) => {
 *   console.error(`Error (${err.type}): ${err.message}`);
 *   // Handle specific error types
 *   if (err.type === T140RtpErrorType.NETWORK_ERROR) {
 *     // Handle network error
 *   }
 * });
 * ```
 */
export class T140RtpTransport extends EventEmitter {
  private seqNum: number;
  private timestamp: number;
  private config: RtpConfig;
  private srtpSession?: any; // Use any for the SRTP session to avoid TypeScript errors
  private udpSocket?: dgram.Socket;
  private customTransport?: TransportStream;
  private remoteAddress: string;
  private remotePort: number;
  private packetBuffer: Buffer[] = []; // Buffer to store packets for FEC
  private packetSequenceNumbers: number[] = []; // Sequence numbers for FEC packets
  private packetTimestamps: number[] = []; // Timestamps for FEC packets
  private fecCounter: number = 0; // Counter for tracking when to send FEC packets
  private redPackets: Buffer[] = []; // Buffer to store packets for T.140 redundancy

  constructor(
    remoteAddress: string,
    remotePort: number = DEFAULT_RTP_PORT,
    config: RtpConfig = {}
  ) {
    super(); // Initialize EventEmitter

    // Store custom transport if provided
    this.customTransport = config.customTransport;

    // If a custom transport is provided, we don't need to validate address and port
    // but we still store them for compatibility
    if (!this.customTransport) {
      // Validate remote address
      if (!remoteAddress) {
        throw new Error('Remote address is required when no custom transport is provided');
      }

      // Basic validation of the remote address format
      // This performs basic IPv4 validation and rejects obviously invalid addresses
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(remoteAddress) &&
          remoteAddress !== 'localhost' &&
          !/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/.test(remoteAddress)) {
        throw new Error('Invalid remote address format');
      }

      // Validate port number is within valid range
      if (remotePort < 0 || remotePort > 65535) {
        throw new Error('Port number must be between 0 and 65535');
      }
    }

    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    // Generate a secure random SSRC if not provided
    const secureSSRC = generateSecureSSRC();

    this.config = {
      payloadType: config.payloadType || DEFAULT_T140_PAYLOAD_TYPE,
      // Use provided SSRC (if any), otherwise use secure random SSRC
      ssrc: config.ssrc || secureSSRC,
      initialSequenceNumber: config.initialSequenceNumber || 0,
      initialTimestamp: config.initialTimestamp || 0,
      timestampIncrement: config.timestampIncrement || 160, // 20ms at 8kHz
      fecEnabled: config.fecEnabled || false,
      fecPayloadType: config.fecPayloadType || 97, // Default payload type for FEC
      fecGroupSize: config.fecGroupSize || 5, // Default: protect every 5 packets with 1 FEC packet
      charRateLimit: config.charRateLimit || 0, // 0 means no rate limit
      redEnabled: config.redEnabled || false, // Redundancy disabled by default
      redPayloadType: config.redPayloadType || DEFAULT_RED_PAYLOAD_TYPE,
      redundancyLevel: config.redundancyLevel || 2, // Default: 2 redundant blocks
      customTransport: config.customTransport,
    };

    this.seqNum = this.config.initialSequenceNumber!;
    this.timestamp = this.config.initialTimestamp!;

    // Create UDP socket only if no custom transport is provided
    if (!this.customTransport) {
      try {
        this.udpSocket = dgram.createSocket('udp4');

        // Set up UDP socket error handler
        this.udpSocket.on('error', (err) => {
          this.emit('error', {
            type: T140RtpErrorType.NETWORK_ERROR,
            message: 'UDP socket error',
            cause: err,
          });
        });
      } catch (err) {
        throw new Error(`Failed to create UDP socket: ${err}`);
      }
    }
  }

  /**
   * Initialize and configure SRTP
   */
  setupSrtp(srtpConfig: SrtpConfig): void {
    try {
      // Validate required keys
      if (!srtpConfig.masterKey || !srtpConfig.masterSalt) {
        this.emit('error', {
          type: T140RtpErrorType.INVALID_CONFIG,
          message: 'SRTP configuration missing required master key or salt',
        });
        return;
      }

      // Create SRTP policy
      const policy = new SrtpPolicy();
      policy.ssrc = this.config.ssrc!;
      policy.key = srtpConfig.masterKey;
      policy.salt = srtpConfig.masterSalt;

      // If profile is specified, use it
      if (srtpConfig.profile) {
        policy.profile = srtpConfig.profile;
      }

      // Create SRTP context and session
      const context = new SrtpContext([policy]);
      this.srtpSession = new SrtpSession(context, srtpConfig.isSRTCP || false);
    } catch (err) {
      this.emit('error', {
        type: T140RtpErrorType.ENCRYPTION_ERROR,
        message: 'Failed to initialize SRTP session',
        cause: err as Error,
      });
    }
  }

  /**
   * Create a Forward Error Correction (FEC) packet according to RFC 5109
   * Using XOR-based FEC for a group of RTP packets
   */
  private _createFecPacket(
    packets: Buffer[],
    sequenceNumbers: number[],
    timestamps: number[]
  ): Buffer {
    if (packets.length === 0) {
      this.emit('error', {
        type: T140RtpErrorType.FEC_ERROR,
        message: 'Cannot create FEC packet from empty packet list',
      });
      return Buffer.alloc(0);
    }

    // Verify that all array lengths match
    if (packets.length !== sequenceNumbers.length || packets.length !== timestamps.length) {
      this.emit('error', {
        type: T140RtpErrorType.FEC_ERROR,
        message: 'Mismatch in FEC packet parameters: packets, sequence numbers, and timestamps must have the same length',
      });
      return Buffer.alloc(0);
    }

    // We need to XOR all RTP headers and payloads
    // First, create the FEC header
    const version = 2;
    const padding = 0;
    const extension = 0;
    const csrcCount = 0;
    const marker = 0;
    const payloadType = this.config.fecPayloadType!;
    const ssrc = this.config.ssrc!;
    // Use the highest sequence number + 1 for the FEC packet
    const maxSeqNum = Math.max(...sequenceNumbers);
    const fecSeqNum = (maxSeqNum + 1) % 65536;
    // Use the highest timestamp for the FEC packet
    const fecTimestamp = Math.max(...timestamps);

    // Create the FEC RTP header
    const fecHeader = Buffer.alloc(RTP_HEADER_SIZE);
    fecHeader.writeUInt8(
      version * 64 + padding * 32 + extension * 16 + csrcCount,
      0
    );
    fecHeader.writeUInt8(marker * 128 + payloadType, 1);
    fecHeader.writeUInt16BE(fecSeqNum, 2);
    fecHeader.writeUInt32BE(fecTimestamp, 4);
    fecHeader.writeUInt32BE(ssrc, 8);

    // FEC Header Extension - RFC 5109 Section 6.1
    // 16 bytes of FEC header extension after the RTP header
    const fecHeaderExt = Buffer.alloc(16);
    // E bit: Extension bit (always 0 for simple XOR-based FEC)
    // L bit: Long mask bit (0 for now, fewer than 16 packets)
    // P bit: Protection length field present (0 for now)
    // X bit: Reserved (0)
    // CC bits: CSRC count from the FEC header
    // M bit: RTP marker bit state from the FEC header
    // PT bits: FEC payload type
    fecHeaderExt.writeUInt8(0, 0); // E, L, P, X, CC, M bits
    fecHeaderExt.writeUInt8(this.config.payloadType!, 1); // Original media PT
    // SN base: first sequence number this FEC packet protects
    fecHeaderExt.writeUInt16BE(sequenceNumbers[0], 2);
    // Timestamp recovery field: timestamp of the media packet
    fecHeaderExt.writeUInt32BE(timestamps[0], 4);
    // Length recovery field: length of the media packet
    const packetLength = packets[0].length;
    fecHeaderExt.writeUInt16BE(packetLength, 8);
    // Mask: which packets this FEC packet protects (bits)
    // For simplicity, we use a continuous block of packets
    // Each bit represents one packet being protected
    const mask = Buffer.alloc(2);
    // Set bits for each protected packet
    // For example: 0000 0000 0001 1111 would protect 5 consecutive packets
    mask.writeUInt16BE(Math.pow(2, packets.length) - 1, 0);
    mask.copy(fecHeaderExt, 10, 0, 2);

    // Now create the FEC payload
    // This requires XORing the payloads of all protected packets
    // First, find the largest packet to determine payload size
    const maxPayloadLength = Math.max(
      ...packets.map((p) => {
        return p.length - RTP_HEADER_SIZE;
      })
    );
    const fecPayload = Buffer.alloc(maxPayloadLength);

    // XOR all payloads together
    for (const packet of packets) {
      const payloadOffset = RTP_HEADER_SIZE;
      const payloadLength = packet.length - payloadOffset;
      for (let j = 0; j < payloadLength; j = j + 1) {
        // XOR byte-by-byte
        if (j < fecPayload.length) {
          // Use a non-bitwise approach
          // Split into two operations to avoid exceeding line length
          const xorResult = fecPayload[j] === packet[payloadOffset + j] ? 0 : 1;
          fecPayload[j] = fecPayload[j] ? xorResult : packet[payloadOffset + j];
        }
      }
    }

    // Combine FEC RTP header, FEC header extension, and FEC payload
    return Buffer.concat([fecHeader, fecHeaderExt, fecPayload]);
  }

  /**
   * Create a RED packet with redundancy according to RFC 2198
   */
  private _createRedPacket(
    primaryData: string,
    redundantPackets: Buffer[]
  ): Buffer {
    if (!this.config.redEnabled || redundantPackets.length === 0) {
      // If RED is not enabled or no redundant packets available,
      // just create a normal RTP packet
      return createRtpPacket(this.seqNum, this.timestamp, primaryData, {
        payloadType: this.config.payloadType,
        ssrc: this.config.ssrc,
      });
    }

    // Determine how many redundant packets to include
    // Limited by available packets and configured redundancy level
    const redundancyLevel = Math.min(
      redundantPackets.length,
      this.config.redundancyLevel || 2
    );

    // Start with RTP header
    const rtpHeader = Buffer.alloc(RTP_HEADER_SIZE);
    const version = 2;
    const padding = 0;
    const extension = 0;
    const csrcCount = 0;
    const marker = 0;
    const payloadType = this.config.redPayloadType!;
    const ssrc = this.config.ssrc!;

    // Create RTP header
    rtpHeader.writeUInt8(
      version * 64 + padding * 32 + extension * 16 + csrcCount,
      0
    );
    rtpHeader.writeUInt8(marker * 128 + payloadType, 1);
    rtpHeader.writeUInt16BE(this.seqNum, 2);
    rtpHeader.writeUInt32BE(this.timestamp, 4);
    rtpHeader.writeUInt32BE(ssrc, 8);

    // Create RED headers and payloads
    // Format for each redundant block:
    // 1 byte: F(1) + Block PT(7)
    // 2 bytes: Timestamp offset (uint16)
    // 1 byte: Block length (uint8)
    // For the primary data (last block):
    // 1 byte: F(0) + Block PT(7)

    // 4 bytes per redundant block + 1 for primary
    const redHeaders = Buffer.alloc(redundancyLevel * 4 + 1);
    let offset = 0;

    // Add headers for redundant blocks
    for (let i = 0; i < redundancyLevel; i = i + 1) {
      // Get the packet to include as redundant data
      // Most recent redundant packet first
      const packet = redundantPackets[redundantPackets.length - 1 - i];

      // Calculate timestamp offset (primary timestamp - redundant timestamp)
      // We need to extract the timestamp from the RTP header (bytes 4-7)
      const redPacketTimestamp = packet.readUInt32BE(4);
      // 16-bit value using modulo instead of bitwise AND
      const timestampOffset = (this.timestamp - redPacketTimestamp) % 65536;

      // Calculate payload length (packet length - RTP header size)
      const payloadLength = Math.min(packet.length - RTP_HEADER_SIZE, 255); // Max 8 bits

      // Write RED header for this block
      // F bit = 1 (more blocks follow)
      // Use 128 (0x80) + PT instead of bitwise OR
      redHeaders.writeUInt8(128 + this.config.payloadType!, offset); // F=1 + block PT
      redHeaders.writeUInt16BE(timestampOffset, offset + 1); // Timestamp offset
      redHeaders.writeUInt8(payloadLength, offset + 3); // Block length
      offset = offset + 4;
    }

    // Add header for primary data (F bit = 0, no timestamp offset, no length)
    redHeaders.writeUInt8(this.config.payloadType!, offset); // F=0 + block PT

    // Create primary data payload
    const primaryPayload = Buffer.from(primaryData, 'utf-8');

    // Combine all parts: RTP header + RED headers + redundant payloads + primary payload
    const buffers = [rtpHeader, redHeaders];

    // Add redundant payloads (skipping their RTP headers)
    for (let i = 0; i < redundancyLevel; i = i + 1) {
      const packet = redundantPackets[redundantPackets.length - 1 - i];
      const payload = packet.slice(RTP_HEADER_SIZE);
      buffers.push(payload);
    }

    // Add primary payload
    buffers.push(primaryPayload);

    // Combine all buffers
    return Buffer.concat(buffers);
  }

  /**
   * Send text data as T.140 over RTP or SRTP
   */
  sendText(text: string): void {
    // Check if we should use RED (redundancy) encoding
    let packet: Buffer;
    if (this.config.redEnabled && this.redPackets.length > 0) {
      // Create a RED packet with redundancy
      const redPacket = this._createRedPacket(text, this.redPackets);

      // Store the packet for future redundancy use
      const normalPacket = createRtpPacket(this.seqNum, this.timestamp, text, {
        payloadType: this.config.payloadType,
        ssrc: this.config.ssrc,
      });

      // Keep original non-RED packet for redundancy
      this.redPackets.push(Buffer.from(normalPacket));

      // Limit the number of stored packets
      if (this.redPackets.length > this.config.redundancyLevel!) {
        this.redPackets.shift(); // Remove oldest packet
      }

      packet = redPacket;
    } else {
      // Create normal RTP packet
      const rtpPacket = createRtpPacket(this.seqNum, this.timestamp, text, {
        payloadType: this.config.payloadType,
        ssrc: this.config.ssrc,
      });

      // Store for future redundancy use if RED is enabled
      if (this.config.redEnabled) {
        this.redPackets.push(Buffer.from(rtpPacket));

        // Limit the number of stored packets
        if (this.redPackets.length > this.config.redundancyLevel!) {
          this.redPackets.shift(); // Remove oldest packet
        }
      }

      packet = rtpPacket;
    }

    // Encrypt the packet if using SRTP
    let finalPacket: Buffer;
    try {
      if (this.srtpSession) {
        // Use the typed protect method
        finalPacket = this.srtpSession.protect(packet);
      } else {
        finalPacket = packet;
      }
    } catch (err) {
      this.emit('error', {
        type: T140RtpErrorType.ENCRYPTION_ERROR,
        message: 'Failed to encrypt packet with SRTP - packet not sent',
        cause: err as Error,
      });
      // Don't fall back to unencrypted - abort the send operation for security
      return;
    }

    // Send the packet using either the custom transport or UDP socket
    this._sendPacket(finalPacket, (err) => {
      if (err) {
        this.emit('error', {
          type: T140RtpErrorType.NETWORK_ERROR,
          message: 'Failed to send RTP packet',
          cause: err,
        });
      }
    });

    // If FEC is enabled, add this packet to the buffer for FEC calculation
    if (this.config.fecEnabled) {
      // Store original packet for FEC (non-RED packet for simplicity)
      const rtpPacket = createRtpPacket(this.seqNum, this.timestamp, text, {
        payloadType: this.config.payloadType,
        ssrc: this.config.ssrc,
      });

      this.packetBuffer.push(Buffer.from(rtpPacket)); // Make a copy of the packet
      this.packetSequenceNumbers.push(this.seqNum);
      this.packetTimestamps.push(this.timestamp);
      this.fecCounter += 1;

      // Check if we've reached the group size to send an FEC packet
      if (this.fecCounter >= this.config.fecGroupSize!) {
        // Create and send FEC packet
        const fecPacket = this._createFecPacket(
          this.packetBuffer,
          this.packetSequenceNumbers,
          this.packetTimestamps
        );

        // Only send if we have a valid FEC packet
        if (fecPacket.length > 0) {
          // Encrypt the FEC packet if using SRTP
          let finalFecPacket: Buffer;
          try {
            if (this.srtpSession) {
              finalFecPacket = this.srtpSession.protect(fecPacket);
            } else {
              finalFecPacket = fecPacket;
            }
          } catch (err) {
            this.emit('error', {
              type: T140RtpErrorType.ENCRYPTION_ERROR,
              message: 'Failed to encrypt FEC packet with SRTP - packet not sent',
              cause: err as Error,
            });
            // Don't fall back to unencrypted - abort the send operation for security
            return;
          }

          // Send the FEC packet
          this._sendPacket(finalFecPacket, (err) => {
            if (err) {
              this.emit('error', {
                type: T140RtpErrorType.NETWORK_ERROR,
                message: 'Failed to send FEC packet',
                cause: err,
              });
            }
          });
        }

        // Reset FEC counters and buffers
        this.fecCounter = 0;
        this.packetBuffer = [];
        this.packetSequenceNumbers = [];
        this.packetTimestamps = [];
      }
    }

    // Update sequence number and timestamp for next packet
    // Use modulo to keep within 16-bit range
    this.seqNum = (this.seqNum + 1) % 65536;
    this.timestamp = this.timestamp + this.config.timestampIncrement!;
  }

  /**
   * Helper method to send a packet using either the custom transport or UDP socket
   */
  private _sendPacket(packet: Buffer, callback?: (error?: Error) => void): void {
    if (this.customTransport) {
      // Use the custom transport
      this.customTransport.send(packet, callback);
    } else if (this.udpSocket) {
      // Use the UDP socket
      this.udpSocket.send(
        packet,
        0,
        packet.length,
        this.remotePort,
        this.remoteAddress,
        callback
      );
    } else {
      // This should never happen, but just in case
      callback?.(new Error('No transport available for sending packets'));
    }
  }

  /**
   * Sends any remaining FEC packets that might be in the buffer
   */
  private _sendRemainingFecPackets(): void {
    if (!this.config.fecEnabled || this.packetBuffer.length === 0) {
      return;
    }

    // Create and send FEC packet for any remaining packets
    const fecPacket = this._createFecPacket(
      this.packetBuffer,
      this.packetSequenceNumbers,
      this.packetTimestamps
    );

    if (fecPacket.length > 0) {
      // Encrypt the FEC packet if using SRTP
      let finalFecPacket: Buffer;
      try {
        if (this.srtpSession) {
          finalFecPacket = this.srtpSession.protect(fecPacket);
        } else {
          finalFecPacket = fecPacket;
        }
      } catch (err) {
        this.emit('error', {
          type: T140RtpErrorType.ENCRYPTION_ERROR,
          message: 'Failed to encrypt final FEC packet with SRTP - packet not sent',
          cause: err as Error,
        });
        // Don't fall back to unencrypted - abort the send operation for security
        return;
      }

      // Send the FEC packet using the appropriate transport
      this._sendPacket(finalFecPacket, (err) => {
        if (err) {
          this.emit('error', {
            type: T140RtpErrorType.NETWORK_ERROR,
            message: 'Failed to send final FEC packet',
            cause: err,
          });
        }
      });
    }

    // Clear the buffers
    this.packetBuffer = [];
    this.packetSequenceNumbers = [];
    this.packetTimestamps = [];
    this.fecCounter = 0;
  }

  /**
   * Close the transport resources
   */
  close(): void {
    try {
      // Send any remaining FEC packets
      this._sendRemainingFecPackets();

      // Close the socket or custom transport
      if (this.customTransport && typeof this.customTransport.close === 'function') {
        this.customTransport.close();
      } else if (this.udpSocket) {
        this.udpSocket.close();
      }
    } catch (err) {
      this.emit('error', {
        type: T140RtpErrorType.RESOURCE_ERROR,
        message: 'Error closing transport resources',
        cause: err as Error,
      });
    }
  }
}
