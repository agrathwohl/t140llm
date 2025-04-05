import { RtpConfig } from '../interfaces';
import { StegConfig } from './steg-config.interface';

/**
 * Extended RTP configuration with steganography support
 */
export interface RtpConfigWithSteg extends RtpConfig {
  /**
   * Steganography configuration
   */
  steganography?: StegConfig;
}
