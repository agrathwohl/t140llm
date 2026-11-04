/**
 * Steganography configuration for a T.140 RTP transport.
 *
 * Encoding is performed by @agrathwohl/llm-steg
 * (https://github.com/agrathwohl/llm-steg), an optional dependency.
 */
export interface StegConfig {
  /**
   * Enable steganography. When false, packets pass through untouched.
   * Default: true.
   */
  enabled?: boolean;

  /**
   * Algorithm to use. 'lsb' hides each bit of the packet in the least
   * significant bit of a cover byte. Default: 'lsb'.
   */
  algorithm?: 'lsb';

  /**
   * Cover media buffers that packets are hidden inside, used round-robin.
   * For LSB each buffer must be at least 8 times the packet size plus a
   * 4-byte length header.
   */
  coverMedia?: Buffer[];

  /** Seed for deterministic encoding. A random seed is generated when omitted. */
  seed?: string;

  /**
   * What to do when a packet cannot be encoded, for example when the cover is
   * too small. 'passthrough' sends the packet unhidden, 'throw' raises an
   * error, 'drop' discards it. Default: 'throw'.
   */
  onError?: 'passthrough' | 'throw' | 'drop';

  /** Log encode and decode operations. Default: false. */
  debug?: boolean;

  /**
   * @deprecated Only 'fixed' is accepted, and it is the default behavior.
   * 'llm' generated and evaluated algorithm code at runtime and was removed.
   */
  encodeMode?: 'fixed';

  /**
   * @deprecated No longer used. Kept so existing configuration objects still
   * type-check.
   */
  encodingRatio?: number;
}
