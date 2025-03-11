import { EventEmitter } from 'events';

/**
 * Interface for any streaming data source
 */
export interface TextDataStream extends EventEmitter {
  on(event: 'data', listener: (data: any) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}
