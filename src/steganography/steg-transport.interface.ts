import { TransportStream } from '../interfaces';
import { StegConfig } from './steg-config.interface';

/**
 * Interface for a steganography-capable transport
 */
export interface StegTransportInterface extends TransportStream {
  /**
   * Apply steganography encoding to the data
   * @param data Original data to be hidden
   * @param cover Cover media to hide the data in
   * @returns Steganographically modified cover containing hidden data
   */
  encode(data: Buffer, cover: Buffer): Buffer;

  /**
   * Apply steganography decoding to extract hidden data
   * @param stegData Steganographically modified cover containing hidden data
   * @returns Extracted original data
   */
  decode(stegData: Buffer): Buffer;

  /**
   * Get the current steganography configuration
   */
  getConfig(): StegConfig;

  /**
   * Update the steganography configuration
   * @param config New configuration to apply
   */
  updateConfig(config: Partial<StegConfig>): void;
}
