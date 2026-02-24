import { EventEmitter } from 'events';

/**
 * Interface representing LLM metadata like tool calls, reasoning, and custom data
 */
export interface LLMMetadata {
  type: 'tool_call' | 'tool_result' | 'custom' | 'reasoning' | string;
  content: unknown;
  id?: string;
}

/**
 * A stream of text data from an LLM or other source.
 *
 * Accepts either:
 * - An EventEmitter emitting 'data', 'end', 'error', and optionally 'metadata' events
 * - An AsyncIterable yielding chunks (for direct use with LLM SDK streams)
 */
export type TextDataStream = EventEmitter | AsyncIterable<unknown>;

/**
 * Configuration options for stream processors
 */
export interface ProcessorOptions {
  processBackspaces?: boolean;
  handleMetadata?: boolean;
  metadataCallback?: (metadata: LLMMetadata) => void;
  sendMetadataOverTransport?: boolean;
  onError?: (error: Error) => void;
  preCreateConnection?: boolean;
}
