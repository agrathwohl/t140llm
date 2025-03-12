import { EventEmitter } from 'events';

/**
 * Interface representing LLM metadata like tool calls and custom data
 */
export interface LLMMetadata {
  type: 'tool_call' | 'tool_result' | 'custom' | string;
  content: any;
  id?: string;
}

/**
 * Interface for any streaming data source
 */
export interface TextDataStream extends EventEmitter {
  on(event: 'data', listener: (data: any) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'metadata', listener: (metadata: LLMMetadata) => void): this;
}
