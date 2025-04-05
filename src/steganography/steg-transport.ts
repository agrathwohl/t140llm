import { TransportStream } from '../interfaces';
import { StegConfig } from './steg-config.interface';
import { StegTransport as IStegTransport } from './steg-transport.interface';

/**
 * Default steganography transport implementation
 * Uses LLM-generated or fixed algorithms to hide RTP packets within cover media
 */
export class StegTransport implements IStegTransport {
  private innerTransport: TransportStream;
  private config: StegConfig;
  private encodeFunction: (data: Buffer, cover: Buffer) => Buffer;
  private decodeFunction: (stegData: Buffer) => Buffer;

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
      seed: config.seed || this.generateRandomSeed(),
      encodingRatio: config.encodingRatio || 100,
      llmProvider: config.llmProvider,
    };

    // Initialize encoding/decoding functions
    if (this.config.encodeMode === 'llm' && this.config.algorithm) {
      // If algorithm is provided directly, use it
      this.initializeFromAlgorithm(this.config.algorithm);
    } else if (this.config.encodeMode === 'llm') {
      // Generate algorithm using LLM
      this.generateLLMAlgorithm()
        .then(algorithm => {
          this.initializeFromAlgorithm(algorithm);
        })
        .catch(err => {
          console.error('Failed to generate LLM steganography algorithm:', err);
          // Fallback to default algorithm
          this.initializeDefaultAlgorithm();
        });
    } else {
      // Use default algorithm
      this.initializeDefaultAlgorithm();
    }
  }

  /**
   * Send data through the transport with steganography applied
   */
  public send(data: Buffer, callback?: (error?: Error) => void): void {
    if (!this.config.enabled || this.config.coverMedia.length === 0) {
      // If steganography is disabled or no cover media available,
      // send data directly through inner transport
      this.innerTransport.send(data, callback);
      return;
    }

    try {
      // Select random cover media
      const coverIdx = Math.floor(Math.random() * this.config.coverMedia.length);
      const cover = this.config.coverMedia[coverIdx];

      // Apply steganography
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

    // Reinitialize if necessary
    if (config.algorithm || config.encodeMode) {
      if (this.config.encodeMode === 'llm' && this.config.algorithm) {
        this.initializeFromAlgorithm(this.config.algorithm);
      } else if (this.config.encodeMode === 'llm') {
        this.generateLLMAlgorithm()
          .then(algorithm => {
            this.initializeFromAlgorithm(algorithm);
          })
          .catch(err => {
            console.error('Failed to regenerate LLM steganography algorithm:', err);
          });
      } else {
        this.initializeDefaultAlgorithm();
      }
    }
  }

  /**
   * Initialize from provided algorithm string
   */
  private initializeFromAlgorithm(algorithm: string): void {
    try {
      // Create function from algorithm string
      // Note: This uses eval which has security implications
      // In a production environment, consider safer alternatives
      // tslint:disable-next-line:no-eval
      const algorithmModule = eval(`(function() {
        ${algorithm}
        return { encode, decode };
      })()`);

      this.encodeFunction = algorithmModule.encode;
      this.decodeFunction = algorithmModule.decode;

      // Validate functions
      if (typeof this.encodeFunction !== 'function' || typeof this.decodeFunction !== 'function') {
        throw new Error('Algorithm must export encode and decode functions');
      }
    } catch (err) {
      console.error('Failed to initialize algorithm:', err);
      // Fallback to default algorithm
      this.initializeDefaultAlgorithm();
    }
  }

  /**
   * Initialize with default LSB steganography algorithm
   */
  private initializeDefaultAlgorithm(): void {
    // Default LSB (Least Significant Bit) algorithm
    this.encodeFunction = (data: Buffer, cover: Buffer): Buffer => {
      // Ensure cover is large enough (at least 8x the data size plus header)
      const headerSize = 4; // 4 bytes to store data length
      const requiredCoverSize = (data.length + headerSize) * 8;

      if (cover.length < requiredCoverSize) {
        throw new Error(`Cover media too small: needs ${requiredCoverSize} bytes, got ${cover.length}`);
      }

      // Create a copy of the cover to modify
      const result = Buffer.from(cover);

      // Store the data length in the first 4 bytes (32 bits)
      for (let i = 0; i < 32; i++) {
        const coverIndex = i;
        const bit = (data.length >> (i % 8)) & 1;
        // Clear the LSB and set it to our data bit
        result[coverIndex] = (result[coverIndex] & 0xFE) | bit;
      }

      // Embed the data bits
      for (let i = 0; i < data.length * 8; i++) {
        const coverIndex = i + 32; // Start after the header
        const byteIndex = Math.floor(i / 8);
        const bitIndex = i % 8;
        const bit = (data[byteIndex] >> bitIndex) & 1;

        // Clear the LSB and set it to our data bit
        result[coverIndex] = (result[coverIndex] & 0xFE) | bit;
      }

      return result;
    };

    this.decodeFunction = (stegData: Buffer): Buffer => {
      // Extract the data length from the first 4 bytes (32 bits)
      let dataLength = 0;
      for (let i = 0; i < 32; i++) {
        const coverIndex = i;
        const bit = stegData[coverIndex] & 1;
        dataLength |= (bit << (i % 8));
      }

      // Validate data length
      if (dataLength <= 0 || dataLength > (stegData.length - 32) / 8) {
        throw new Error('Invalid data length in steganographic content');
      }

      // Extract the data
      const result = Buffer.alloc(dataLength);
      for (let i = 0; i < dataLength * 8; i++) {
        const coverIndex = i + 32; // Start after the header
        const byteIndex = Math.floor(i / 8);
        const bitIndex = i % 8;
        const bit = stegData[coverIndex] & 1;

        // Set the bit in the result buffer
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
  private async generateLLMAlgorithm(): Promise<string> {
    // If no LLM provider or prompt, use default algorithm
    if (!this.config.llmProvider || !this.config.prompt) {
      return this.getDefaultAlgorithmString();
    }

    try {
      const llm = this.config.llmProvider;
      const defaultPrompt = this.getDefaultLLMPrompt();
      const prompt = this.config.prompt || defaultPrompt;

      // Call LLM API
      const response = await llm.createCompletion({
        model: 'text-davinci-003', // Use appropriate model
        prompt,
        max_tokens: 2000,
        temperature: 0.5,
      });

      // Extract algorithm from response
      const algorithm = response.choices[0].text.trim();
      return algorithm;
    } catch (err) {
      console.error('Failed to generate algorithm with LLM:', err);
      return this.getDefaultAlgorithmString();
    }
  }

  /**
   * Get the default LLM prompt for algorithm generation
   */
  private getDefaultLLMPrompt(): string {
    return `Generate a steganography algorithm for hiding binary data in cover media.
The algorithm should:
1. Hide an RTP packet (data Buffer) inside cover media (cover Buffer)
2. Be robust against basic statistical analysis
3. Use the seed: ${this.config.seed || 'random-seed'}

The output should include two functions:
1. encode(data: Buffer, cover: Buffer): Buffer
   - Takes the data to hide and the cover media
   - Returns the modified cover with hidden data

2. decode(stegData: Buffer): Buffer
   - Takes the steganographically modified cover
   - Returns the extracted hidden data

The algorithm should handle errors gracefully and include basic validation.
Use pure JavaScript/TypeScript with no external dependencies.`;
  }

  /**
   * Get the default algorithm implementation as a string
   */
  private getDefaultAlgorithmString(): string {
    return `
// Encode function - LSB steganography
function encode(data, cover) {
  // Ensure cover is large enough (at least 8x the data size plus header)
  const headerSize = 4; // 4 bytes to store data length
  const requiredCoverSize = (data.length + headerSize) * 8;

  if (cover.length < requiredCoverSize) {
    throw new Error(\`Cover media too small: needs \${requiredCoverSize} bytes, got \${cover.length}\`);
  }

  // Create a copy of the cover to modify
  const result = Buffer.from(cover);

  // Store the data length in the first 4 bytes (32 bits)
  for (let i = 0; i < 32; i++) {
    const coverIndex = i;
    const bit = (data.length >> (i % 8)) & 1;
    // Clear the LSB and set it to our data bit
    result[coverIndex] = (result[coverIndex] & 0xFE) | bit;
  }

  // Embed the data bits
  for (let i = 0; i < data.length * 8; i++) {
    const coverIndex = i + 32; // Start after the header
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const bit = (data[byteIndex] >> bitIndex) & 1;

    // Clear the LSB and set it to our data bit
    result[coverIndex] = (result[coverIndex] & 0xFE) | bit;
  }

  return result;
}

// Decode function - LSB steganography
function decode(stegData) {
  // Extract the data length from the first 4 bytes (32 bits)
  let dataLength = 0;
  for (let i = 0; i < 32; i++) {
    const coverIndex = i;
    const bit = stegData[coverIndex] & 1;
    dataLength |= (bit << (i % 8));
  }

  // Validate data length
  if (dataLength <= 0 || dataLength > (stegData.length - 32) / 8) {
    throw new Error('Invalid data length in steganographic content');
  }

  // Extract the data
  const result = Buffer.alloc(dataLength);
  for (let i = 0; i < dataLength * 8; i++) {
    const coverIndex = i + 32; // Start after the header
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const bit = stegData[coverIndex] & 1;

    // Set the bit in the result buffer
    if (bit) {
      result[byteIndex] |= (1 << bitIndex);
    }
  }

  return result;
}`;
  }

  /**
   * Generate a random seed for the steganography algorithm
   */
  private generateRandomSeed(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }
}
