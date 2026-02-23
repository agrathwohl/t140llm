/**
 * Interface for steganography configuration
 */
export interface StegConfig {
  /**
   * Enable steganography for the transport
   */
  enabled: boolean;

  /**
   * Mode for encoding algorithm generation
   * - 'llm': Use LLM to generate the algorithm
   * - 'fixed': Use a built-in algorithm
   */
  encodeMode: 'llm' | 'fixed';

  /**
   * Cover media buffers to use for steganography
   * These could be image samples, audio samples, or other media
   */
  coverMedia?: Buffer[];

  /**
   * Prompt to use for LLM algorithm generation
   * Only used when encodeMode is 'llm'
   */
  prompt?: string;

  /**
   * Pre-generated algorithm code when not using dynamic generation
   * Only used when encodeMode is 'fixed'
   */
  algorithm?: string;

  /**
   * Random seed for deterministic algorithm generation
   */
  seed?: string;

  /**
   * Percentage of packet content to encode (0-100)
   * Default: 100 (encode the entire packet)
   */
  encodingRatio?: number;

  /**
   * Custom LLM provider for algorithm generation
   * If not provided, will attempt to use OpenAI
   */
  llmProvider?: unknown;
}
