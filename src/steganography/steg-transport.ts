import { randomBytes } from 'crypto';
import { TransportStream } from '../interfaces';
import { StegConfig } from './steg-config.interface';
import { StegTransportInterface } from './steg-transport.interface';

/**
 * Default steganography transport implementation
 * Uses fixed algorithms to hide RTP packets within cover media
 */
export class StegTransport implements StegTransportInterface {
  private innerTransport: TransportStream;
  private config: StegConfig;
  private encodeFunction!: (data: Buffer, cover: Buffer) => Buffer;
  private decodeFunction!: (stegData: Buffer) => Buffer;

  /**
   * Create a new steganography transport
   * @param innerTransport The underlying transport to wrap
   * @param config Steganography configuration
   */
  constructor(innerTransport: TransportStream, config: StegConfig) {
    if (config.encodeMode === 'llm') {
      throw new Error(
        'LLM encode mode has been removed due to security concerns (arbitrary code execution via eval). ' +
        'Use encodeMode: \'fixed\' instead.'
      );
    }

    this.innerTransport = innerTransport;
    this.config = {
      enabled: config.enabled === undefined ? true : config.enabled,
      encodeMode: 'fixed',
      coverMedia: config.coverMedia || [],
      prompt: config.prompt,
      algorithm: config.algorithm,
      seed: config.seed || this._generateRandomSeed(),
      encodingRatio: config.encodingRatio || 100,
      llmProvider: config.llmProvider
    };

    this._initializeDefaultAlgorithm();
  }

  /**
   * Send data through the transport with steganography applied
   */
  public send(data: Buffer, callback?: (error?: Error) => void): void {
    if (!this.config.enabled || !this.config.coverMedia || this.config.coverMedia.length === 0) {
      this.innerTransport.send(data, callback);
      return;
    }

    try {
      const coverIdx = randomBytes(4).readUInt32BE(0) % this.config.coverMedia.length;
      const cover = this.config.coverMedia[coverIdx];
      const stegData = this.encode(data, cover);
      this.innerTransport.send(stegData, callback);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (callback) {
        callback(error);
      }
      throw error;
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
    if (!this.encodeFunction) {
      throw new Error('Steganography encode function not initialized');
    }
    return this.encodeFunction(data, cover);
  }

  /**
   * Decode steganographically hidden data
   */
  public decode(stegData: Buffer): Buffer {
    if (!this.decodeFunction) {
      throw new Error('Steganography decode function not initialized');
    }
    return this.decodeFunction(stegData);
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
    if (config.encodeMode === 'llm') {
      throw new Error(
        'LLM encode mode has been removed due to security concerns (arbitrary code execution via eval). ' +
        'Use encodeMode: \'fixed\' instead.'
      );
    }

    this.config = { ...this.config, ...config };

    if (config.algorithm || config.encodeMode) {
      this._initializeDefaultAlgorithm();
    }
  }

  /**
   * Initialize with default LSB steganography algorithm
   */
  private _initializeDefaultAlgorithm(): void {
    this.encodeFunction = (data: Buffer, cover: Buffer): Buffer => {
      const headerSize = 4;
      const requiredCoverSize = (data.length + headerSize) * 8;

      if (cover.length < requiredCoverSize) {
        throw new Error(`Cover media too small: needs ${requiredCoverSize} bytes, got ${cover.length}`);
      }

      const result = Buffer.from(cover);

      // Store the data length in the first 32 bits
      for (let i = 0; i < 32; i++) {
        const bit = (data.length >> i) & 1;
        result[i] = (result[i] & 0xFE) | bit;
      }

      // Embed the data bits
      for (let i = 0; i < data.length * 8; i++) {
        const coverIndex = i + 32;
        const byteIndex = Math.floor(i / 8);
        const bitIndex = i % 8;
        const bit = (data[byteIndex] >> bitIndex) & 1;
        result[coverIndex] = (result[coverIndex] & 0xFE) | bit;
      }

      return result;
    };

    this.decodeFunction = (stegData: Buffer): Buffer => {
      let dataLength = 0;
      for (let i = 0; i < 32; i++) {
        const bit = stegData[i] & 1;
        dataLength |= (bit << i);
      }

      if (dataLength <= 0 || dataLength > (stegData.length - 32) / 8) {
        throw new Error('Invalid data length in steganographic content');
      }

      const result = Buffer.alloc(dataLength);
      for (let i = 0; i < dataLength * 8; i++) {
        const coverIndex = i + 32;
        const byteIndex = Math.floor(i / 8);
        const bitIndex = i % 8;
        const bit = stegData[coverIndex] & 1;
        if (bit) {
          result[byteIndex] |= (1 << bitIndex);
        }
      }

      return result;
    };
  }

  private _generateRandomSeed(): string {
    return randomBytes(16).toString('hex');
  }
}
