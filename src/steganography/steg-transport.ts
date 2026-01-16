import {
  LSBAlgorithm,
  StegConfig as LlmStegConfig,
  StegEngine
} from '@agrathwohl/llm-steg';
import { TransportStream } from '../interfaces';
import { StegConfig } from './steg-config.interface';
import { StegTransportInterface } from './steg-transport.interface';

/**
 * Steganography transport implementation using llm-steg package.
 * Uses LSB algorithm to hide RTP packets within cover media.
 */
export class StegTransport implements StegTransportInterface {
  private innerTransport: TransportStream;
  private config: StegConfig;
  private engine: StegEngine;

  /**
   * Create a new steganography transport
   * @param innerTransport The underlying transport to wrap
   * @param config Steganography configuration
   */
  constructor(innerTransport: TransportStream, config: StegConfig) {
    this.innerTransport = innerTransport;

    // Normalize config with defaults
    this.config = {
      llmProvider: config.llmProvider,
      prompt: config.prompt,
      algorithm: config.algorithm,
      enabled: config.enabled === undefined ? true : config.enabled,
      encodeMode: config.encodeMode || 'fixed',
      coverMedia: config.coverMedia || [],
      seed: config.seed || this._generateRandomSeed(),
      encodingRatio: config.encodingRatio || 100,
    };

    // Create llm-steg engine configuration
    const llmStegConfig: LlmStegConfig = {
      enabled: this.config.enabled,
      algorithm: 'lsb',
      coverMedia: this.config.coverMedia,
      onError: 'passthrough',
    };

    // Initialize engine with LSB algorithm
    this.engine = new StegEngine(llmStegConfig);
    const lsb = new LSBAlgorithm(
      this.config.seed ? { seed: this.config.seed } : undefined
    );
    this.engine.setAlgorithm(lsb);
  }

  /**
   * Send data through the transport with steganography applied
   */
  public send(data: Buffer, callback?: (error?: Error) => void): void {
    if (!this.config.enabled || !this.config.coverMedia || this.config.coverMedia.length === 0) {
      // If steganography is disabled or no cover media available,
      // send data directly through inner transport
      this.innerTransport.send(data, callback);
      return;
    }

    try {
      // Select random cover media
      const coverIdx = Math.floor(
        Math.random() * this.config.coverMedia.length
      );
      const cover = this.config.coverMedia[coverIdx];

      // Apply steganography using engine
      const stegData = this.encode(data, cover);

      // Send through inner transport
      this.innerTransport.send(stegData, callback);
    } catch (err) {
      // If steganography fails, fall back to direct transmission
      console.error('Steganography encoding failed:', err);
      this.innerTransport.send(data, callback);
    }
  }

  /**
   * Close the transport
   */
  public close(): void {
    if (this.innerTransport.close) {
      this.innerTransport.close();
    }
  }

  /**
   * Encode data using steganography
   */
  public encode(data: Buffer, cover: Buffer): Buffer {
    const algorithm = this.engine.getAlgorithm();
    if (!algorithm) {
      throw new Error('Steganography algorithm not initialized');
    }
    return algorithm.encode(data, cover);
  }

  /**
   * Decode steganographically hidden data
   */
  public decode(stegData: Buffer): Buffer {
    const algorithm = this.engine.getAlgorithm();
    if (!algorithm) {
      throw new Error('Steganography algorithm not initialized');
    }
    return algorithm.decode(stegData);
  }

  /**
   * Get current steganography configuration
   */
  public getConfig(): StegConfig {
    return { ...this.config };
  }

  /**
   * Update steganography configuration
   */
  public updateConfig(config: Partial<StegConfig>): void {
    this.config = { ...this.config, ...config };

    // Update engine configuration
    if (config.enabled !== undefined) {
      this.engine.updateConfig({ enabled: config.enabled });
    }

    if (config.coverMedia) {
      // Clear and re-add cover media
      this.engine.updateConfig({ coverMedia: [] });
      for (const media of config.coverMedia) {
        this.engine.addCoverMedia(media);
      }
    }

    // Update algorithm seed if changed
    if (config.seed) {
      const lsb = new LSBAlgorithm({ seed: config.seed });
      this.engine.setAlgorithm(lsb);
    }
  }

  /**
   * Generate a random seed for the steganography algorithm
   */
  private _generateRandomSeed(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
