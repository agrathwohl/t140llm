import { RtpConfig } from './rtp-config.interface';

/**
 * Valid SRTP protection profiles per IANA registry
 * @see https://www.iana.org/assignments/srtp-protection/srtp-protection.xhtml
 */
export type SrtpProtectionProfile =
  | 0x0001  // SRTP_AES128_CM_HMAC_SHA1_80
  | 0x0002  // SRTP_AES128_CM_HMAC_SHA1_32
  | 0x0005  // SRTP_AEAD_AES_128_GCM
  | 0x0006  // SRTP_AEAD_AES_256_GCM
  | 0x0007  // DOUBLE_AEAD_AES_128_GCM_AEAD_AES_128_GCM
  | 0x0008; // DOUBLE_AEAD_AES_256_GCM_AEAD_AES_256_GCM

/**
 * Interface for SRTP specific configuration
 */
export interface SrtpConfig extends Omit<RtpConfig, 'charRateLimit'> {
  masterKey: Buffer;
  masterSalt: Buffer;
  profile?: SrtpProtectionProfile;
  isSRTCP?: boolean; // Default: false
}
