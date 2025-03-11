import { RtpConfig } from './rtp-config.interface';

/**
 * Interface for SRTP specific configuration
 */
export interface SrtpConfig extends RtpConfig {
  masterKey: Buffer;
  masterSalt: Buffer;
  profile?: number; // Default: SRTP_AES128_CM_HMAC_SHA1_80
  isSRTCP?: boolean; // Default: false
}
