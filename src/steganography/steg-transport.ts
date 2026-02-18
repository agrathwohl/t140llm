import { TransportStream } from '../interfaces';
import { StegConfig } from './steg-config.interface';
import { StegTransportInterface } from './steg-transport.interface';

/**
 * Default steganography transport implementation
 * Uses LLM-generated or fixed algorithms to hide RTP packets within cover media
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
    this.innerTransport = innerTransport;
    this.config = {
      enabled: config.enabled === undefined ? true : config.enabled,
      encodeMode: config.encodeMode || 'fixed',
      coverMedia: config.coverMedia || [],
      prompt: config.prompt,
      algorithm: config.algorithm,
      seed: config.seed || this._generateRandomSeed(),
      encodingRatio: config.encodingRatio || 100,
      llmProvider: config.llmProvider
    };

    // Initialize encoding/decoding functions
    if (this.config.encodeMode === 'llm' && this.config.algorithm) {
      this._initializeFromAlgorithm(this.config.algorithm);
    } else if (this.config.encodeMode === 'llm') {
      this._generateLLMAlgorithm()
        .then(algorithm => {
          this._initializeFromAlgorithm(algorithm);
        })
        .catch(err => {
          console.error('Failed to generate LLM steganography algorithm:', err);
          this._initializeDefaultAlgorithm();
        });
    } else {
      this._initializeDefaultAlgorithm();
    }
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
      const coverIdx = Math.floor(Math.random() * this.config.coverMedia.length);
      const cover = this.config.coverMedia[coverIdx];
      const stegData = this.encode(data, cover);
      this.innerTransport.send(stegData, callback);
    } catch (err) {
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
    this.config = { ...this.config, ...config };

    if (config.algorithm || config.encodeMode) {
      if (this.config.encodeMode === 'llm' && this.config.algorithm) {
        this._initializeFromAlgorithm(this.config.algorithm);
      } else if (this.config.encodeMode === 'llm') {
        this._generateLLMAlgorithm()
          .then(algorithm => {
            this._initializeFromAlgorithm(algorithm);
          })
          .catch(err => {
            console.error('Failed to regenerate LLM steganography algorithm:', err);
          });
      } else {
        this._initializeDefaultAlgorithm();
      }
    }
  }

  /**
   * Initialize from provided algorithm string
   */
  private _initializeFromAlgorithm(algorithm: string): void {
    try {
      // eslint-disable-next-line no-eval
      const algorithmModule = eval(`(function() {
        ${algorithm}
        return { encode, decode };
      })()`);

      this.encodeFunction = algorithmModule.encode;
      this.decodeFunction = algorithmModule.decode;

      if (typeof this.encodeFunction !== 'function' || typeof this.decodeFunction !== 'function') {
        throw new Error('Algorithm must export encode and decode functions');
      }
    } catch (err) {
      console.error('Failed to initialize algorithm:', err);
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
        const bit = (data.length >> (i % 8)) & 1;
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
        dataLength |= (bit << (i % 8));
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

  /**
   * Generate steganography algorithm using LLM
   */
  private async _generateLLMAlgorithm(): Promise<string> {
    if (!this.config.llmProvider || !this.config.prompt) {
      return this._getDefaultAlgorithmString();
    }

    try {
      const llm = this.config.llmProvider;
      const prompt = this.config.prompt || this._getDefaultLLMPrompt();

      const response = await llm.createCompletion({
        model: 'text-davinci-003',
        prompt,
        max_tokens: 2000,
        temperature: 0.5,
      });

      return response.choices[0].text.trim();
    } catch (err) {
      console.error('Failed to generate algorithm with LLM:', err);
      return this._getDefaultAlgorithmString();
    }
  }

  private _getDefaultLLMPrompt(): string {
    return `Generate a steganography algorithm for hiding binary data in cover media.
The algorithm should:
1. Hide an RTP packet (data Buffer) inside cover media (cover Buffer)
2. Be robust against basic statistical analysis
3. Use the seed: ${this.config.seed || 'random-seed'}

The output should include two functions:
1. encode(data: Buffer, cover: Buffer): Buffer
2. decode(stegData: Buffer): Buffer

Use pure JavaScript/TypeScript with no external dependencies.`;
  }

  private _getDefaultAlgorithmString(): string {
    return `
function encode(data, cover) {
  const headerSize = 4;
  const requiredCoverSize = (data.length + headerSize) * 8;
  if (cover.length < requiredCoverSize) {
    throw new Error('Cover media too small: needs ' + requiredCoverSize + ' bytes, got ' + cover.length);
  }
  const result = Buffer.from(cover);
  for (let i = 0; i < 32; i++) {
    const bit = (data.length >> (i % 8)) & 1;
    result[i] = (result[i] & 0xFE) | bit;
  }
  for (let i = 0; i < data.length * 8; i++) {
    const coverIndex = i + 32;
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const bit = (data[byteIndex] >> bitIndex) & 1;
    result[coverIndex] = (result[coverIndex] & 0xFE) | bit;
  }
  return result;
}
function decode(stegData) {
  let dataLength = 0;
  for (let i = 0; i < 32; i++) {
    const bit = stegData[i] & 1;
    dataLength |= (bit << (i % 8));
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
    if (bit) { result[byteIndex] |= (1 << bitIndex); }
  }
  return result;
}`;
  }

  private _generateRandomSeed(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
