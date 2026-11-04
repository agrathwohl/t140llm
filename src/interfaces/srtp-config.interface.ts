import { RtpConfig } from './rtp-config.interface';

/**
 * SRTP protection profiles, numbered per the IANA registry
 * https://www.iana.org/assignments/srtp-protection/srtp-protection.xhtml
 *
 * Only the two profiles that the bundled SRTP implementation supports are accepted.
 */
export type SrtpProtectionProfile =
  | 0x0001  // SRTP_AES128_CM_HMAC_SHA1_80 (RFC 5764), 16-byte key, 14-byte salt
  | 0x0007; // SRTP_AEAD_AES_128_GCM (RFC 7714), 16-byte key, 12-byte salt

/**
 * SRTP configuration.
 *
 * Supply `masterKey` and `masterSalt` yourself, or let
 * `createT140DtlsSrtpTransport` derive them with a DTLS-SRTP handshake
 * (RFC 5764), which is the key management RFC 3711 §9.1 requires.
 */
export interface SrtpConfig extends Omit<RtpConfig, 'charRateLimit'> {
  /** Send-direction master key. 16 bytes for both supported profiles. */
  masterKey: Buffer;
  /** Send-direction master salt. 14 bytes for profile 0x0001, 12 for 0x0007. */
  masterSalt: Buffer;
  /** Receive-direction master key. Defaults to `masterKey`. */
  remoteMasterKey?: Buffer;
  /** Receive-direction master salt. Defaults to `masterSalt`. */
  remoteMasterSalt?: Buffer;
  profile?: SrtpProtectionProfile;
  isSRTCP?: boolean; // Default: false
}
