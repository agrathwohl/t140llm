import * as dgram from 'dgram';
import { AddressInfo, isIP } from 'net';
// werift-dtls declares main as lib/index.js but ships no such file, so this
// deep path is the package's only working entry point. Pinned to ^0.5.8.
import {
  CipherContext,
  DtlsClient,
  DtlsServer,
  DtlsSocket,
  HashAlgorithm,
  NamedCurveAlgorithm,
  SignatureAlgorithm,
} from 'werift-dtls/lib/dtls/src';
import { SrtpProtectionProfile, TransportStream } from '../interfaces';
import {
  DTLS_HANDSHAKE_TIMEOUT_MS,
  DTLS_RECORD_FIRST_BYTE_MAX,
  DTLS_RECORD_FIRST_BYTE_MIN,
  RTP_FIRST_BYTE_MAX,
  RTP_FIRST_BYTE_MIN,
  SRTP_AEAD_SALT_SIZE,
  SRTP_MASTER_KEY_SIZE,
  SRTP_MASTER_SALT_SIZE,
} from '../utils/constants';

/** Options for a DTLS-SRTP handshake (RFC 5764). */
export interface DtlsSrtpOptions {
  /**
   * 'client' sends the ClientHello and is the active side.
   * 'server' waits for a peer. Default: 'client'.
   */
  role?: 'client' | 'server';
  /** Certificate PEM. A self-signed ECDSA certificate is generated when omitted. */
  certPem?: string;
  /** Private key PEM. Required with `certPem`. */
  keyPem?: string;
  /** Profiles to offer, most preferred first. Default: both supported profiles. */
  profiles?: SrtpProtectionProfile[];
  /** Local UDP port to bind. Default: an ephemeral port. */
  localPort?: number;
  /** Give up on the handshake after this long. Default 10000 ms. */
  handshakeTimeoutMs?: number;
  /**
   * Server role only: ask the client for a certificate. Without this the
   * server has no `remoteCertificate` to check. Default: false.
   */
  certificateRequest?: boolean;
  /** Reuse an existing bound UDP socket instead of creating one. */
  socket?: dgram.Socket;
  /**
   * Called for each inbound (S)RTP packet on the shared port. The handshake
   * and the media share one 5-tuple, so a receiver reads its packets here.
   */
  onRtpPacket?: (packet: Buffer, remote: dgram.RemoteInfo) => void;
  /**
   * Called with the peer's certificate once the handshake completes. Throw to
   * reject the peer, for example when its fingerprint is not the expected one.
   */
  verifyRemoteCertificate?: (certificate: Buffer | undefined) => void;
}

/** Keys and transport produced by a completed DTLS-SRTP handshake. */
export interface DtlsSrtpSession {
  /** Send-direction master key, for T140RtpTransport.setupSrtp. */
  masterKey: Buffer;
  /** Send-direction master salt. */
  masterSalt: Buffer;
  /** Receive-direction master key. */
  remoteMasterKey: Buffer;
  /** Receive-direction master salt. */
  remoteMasterSalt: Buffer;
  /** The profile both sides agreed on. */
  profile: SrtpProtectionProfile;
  /**
   * The peer's certificate, for fingerprint checks. A client always receives
   * the server's certificate. A server only receives one when it was started
   * with `certificateRequest: true`.
   */
  remoteCertificate?: Buffer;
  /** Sends SRTP on the same 5-tuple the handshake used. */
  transport: TransportStream;
  /** Local address and port of the shared socket. */
  localAddress: AddressInfo;
  /** Closes the DTLS session and the socket. */
  close(): void;
}

/** Salt length in bytes for a profile (werift SRTP, RFC 5764 §4.1.2, RFC 7714 §8.1). */
function saltSizeFor(profile: SrtpProtectionProfile): number {
  return profile === 0x0007 ? SRTP_AEAD_SALT_SIZE : SRTP_MASTER_SALT_SIZE;
}

/**
 * Minimal werift-dtls Transport over one UDP socket. For the server role the
 * peer address is learned from the first datagram received.
 */
class DtlsUdpTransport {
  readonly type = 'udp';
  closed = false;
  onData: (data: Buffer, addr: readonly [string, number]) => void = () => undefined;

  constructor(
    private readonly socket: dgram.Socket,
    public remote: { address: string; port: number }
  ) {}

  get address(): AddressInfo {
    return this.socket.address() as AddressInfo;
  }

  send = (data: Buffer): Promise<void> => new Promise<void>((resolve, reject) => {
    this.socket.send(data, 0, data.length, this.remote.port, this.remote.address, (err) => {
      if (err) reject(err);
      else resolve();
    });
  })

  close = async (): Promise<void> => {
    this.closed = true;
  }
}

function bindSocket(socket: dgram.Socket, port?: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, () => {
      socket.removeListener('error', reject);
      resolve();
    });
  });
}

/**
 * Derive SRTP keys with a DTLS-SRTP handshake (RFC 5764), the automatic key
 * management that RFC 3711 §9.1 requires.
 * https://www.rfc-editor.org/rfc/rfc5764
 *
 * The handshake and the media share one UDP 5-tuple. Inbound packets are
 * separated by their first byte per RFC 5764 §5.1.2: 20-63 is a DTLS record,
 * 128-191 is (S)RTP or (S)RTCP.
 *
 * @param remoteAddress Peer address. For the server role, the address to reply
 *   to until the first datagram arrives.
 * @param remotePort Peer port.
 * @param options Role, certificate, profiles, timeout.
 * @returns The negotiated keys, profile, and a transport on the same socket.
 */
export async function negotiateDtlsSrtp(
  remoteAddress: string,
  remotePort: number,
  options: DtlsSrtpOptions = {}
): Promise<DtlsSrtpSession> {
  const role = options.role ?? 'client';
  const profiles = options.profiles ?? [0x0001, 0x0007];
  const timeoutMs = options.handshakeTimeoutMs ?? DTLS_HANDSHAKE_TIMEOUT_MS;

  const ownsSocket = options.socket === undefined;
  const socket =
    options.socket ?? dgram.createSocket(isIP(remoteAddress) === 6 ? 'udp6' : 'udp4');
  if (ownsSocket) {
    await bindSocket(socket, options.localPort);
  }

  const transport = new DtlsUdpTransport(socket, {
    address: remoteAddress,
    port: remotePort,
  });
  let peerLearned = role === 'client';

  socket.on('message', (packet, rinfo) => {
    const first = packet[0];
    if (first >= DTLS_RECORD_FIRST_BYTE_MIN && first <= DTLS_RECORD_FIRST_BYTE_MAX) {
      if (!peerLearned) {
        transport.remote = { address: rinfo.address, port: rinfo.port };
        peerLearned = true;
      }
      transport.onData(packet, [rinfo.address, rinfo.port]);
      return;
    }
    if (first >= RTP_FIRST_BYTE_MIN && first <= RTP_FIRST_BYTE_MAX) {
      options.onRtpPacket?.(packet, rinfo);
    }
  });

  const signatureHash = { hash: HashAlgorithm.sha256_4, signature: SignatureAlgorithm.ecdsa_3 };
  const credentials =
    options.certPem && options.keyPem
      ? { signatureHash, certPem: options.certPem, keyPem: options.keyPem }
      : await CipherContext.createSelfSignedCertificateWithKey(
        signatureHash,
        NamedCurveAlgorithm.secp256r1_23
      );

  const dtlsOptions = {
    transport,
    srtpProfiles: profiles,
    cert: credentials.certPem,
    key: credentials.keyPem,
    signatureHash: credentials.signatureHash,
    certificateRequest: options.certificateRequest ?? false,
  };
  const dtls: DtlsSocket =
    role === 'server' ? new DtlsServer(dtlsOptions) : new DtlsClient(dtlsOptions);

  const closeAll = (): void => {
    dtls.close();
    if (ownsSocket) {
      try {
        socket.close();
      } catch (_err) {
        // Already closed.
      }
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`DTLS handshake did not complete within ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref?.();
      const settle = (err?: Error): void => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      dtls.onConnect.subscribe(() => settle());
      dtls.onError.subscribe((err: Error) => settle(err));
      if (dtls instanceof DtlsClient) {
        dtls.connect().catch((err) => settle(err as Error));
      }
    });

    const profile = dtls.srtp.srtpProfile as SrtpProtectionProfile | undefined;
    if (!profile) {
      throw new Error('DTLS peer did not negotiate an SRTP protection profile');
    }

    options.verifyRemoteCertificate?.(dtls.remoteCertificate);

    const keys = dtls.extractSessionKeys(SRTP_MASTER_KEY_SIZE, saltSizeFor(profile));

    return {
      profile,
      masterKey: keys.localKey,
      masterSalt: keys.localSalt,
      remoteMasterKey: keys.remoteKey,
      remoteMasterSalt: keys.remoteSalt,
      remoteCertificate: dtls.remoteCertificate,
      localAddress: socket.address() as AddressInfo,
      transport: {
        send: (data: Buffer, callback?: (error?: Error) => void): void => {
          socket.send(
            data,
            0,
            data.length,
            transport.remote.port,
            transport.remote.address,
            (err) => callback?.(err ?? undefined)
          );
        },
        close: closeAll,
      },
      close: closeAll,
    };
  } catch (err) {
    closeAll();
    throw err;
  }
}
