/**
 * Ambient types for the optional dependency @agrathwohl/llm-steg.
 * https://github.com/agrathwohl/llm-steg
 *
 * The package is published to GitHub Packages, so it is declared as an
 * optionalDependency and may be absent. These declarations mirror the subset
 * of its public API that this module uses, so `tsc` succeeds either way.
 * Install it with:
 *   npm config set @agrathwohl:registry https://npm.pkg.github.com
 *   NODE_AUTH_TOKEN=<token with read:packages> npm install @agrathwohl/llm-steg
 */
declare module '@agrathwohl/llm-steg' {
  export type StegAlgorithmMode =
    | 'lsb'
    | 'dct'
    | 'spread'
    | 'llm-generated'
    | 'custom';

  export interface CoverMedia {
    data: Buffer;
    type?: string;
    id?: string;
    capacity?: number;
  }

  export interface StegAlgorithm {
    readonly name: string;
    encode(data: Buffer, cover: Buffer): Buffer;
    decode(stegData: Buffer): Buffer;
    calculateCapacity(cover: Buffer): number;
    setSeed?(seed: string): void;
    validateCover?(cover: Buffer): boolean;
  }

  export interface AlgorithmOptions {
    seed?: string;
    config?: Record<string, unknown>;
    debug?: boolean;
  }

  export interface LlmStegConfig {
    enabled?: boolean;
    algorithm?: StegAlgorithmMode;
    coverMedia?: (Buffer | CoverMedia)[];
    algorithmCode?: string;
    llmPrompt?: string;
    llmProvider?: unknown;
    seed?: string;
    encodingRatio?: number;
    onError?: 'passthrough' | 'throw' | 'drop';
    debug?: boolean;
  }

  export interface StegEncodeResult {
    data: Buffer;
    payloadSize: number;
    coverSize: number;
    algorithm: StegAlgorithmMode;
    success: boolean;
    error?: string;
  }

  export interface StegDecodeResult {
    data: Buffer;
    payloadSize: number;
    algorithm: StegAlgorithmMode;
    success: boolean;
    error?: string;
  }

  export class LSBAlgorithm implements StegAlgorithm {
    readonly name: string;
    constructor(options?: AlgorithmOptions);
    encode(data: Buffer, cover: Buffer): Buffer;
    decode(stegData: Buffer): Buffer;
    calculateCapacity(cover: Buffer): number;
    setSeed(seed: string): void;
    getSeed(): string | null;
    validateCover(cover: Buffer): boolean;
  }

  export class StegEngine {
    constructor(config?: LlmStegConfig);
    setAlgorithm(algorithm: StegAlgorithm): void;
    getAlgorithm(): StegAlgorithm | null;
    encode(data: Buffer): StegEncodeResult;
    decode(stegData: Buffer): StegDecodeResult;
    addCoverMedia(media: Buffer | CoverMedia): void;
    getConfig(): LlmStegConfig;
    updateConfig(config: Partial<LlmStegConfig>): void;
    getPoolStats(): { size: number; totalCapacity: number; averageCapacity: number };
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export class CoverGenerator {
    constructor(options?: { minSize?: number; maxSize?: number });
    generateNoise(size: number): CoverMedia;
    ensureCapacity(payloadSize: number): CoverMedia;
  }
}
