import { ProcessorOptions } from './text-data-stream.interface';

export interface TLSOptions {
  rejectUnauthorized?: boolean;
  ca?: string;
  cert?: string;
  key?: string;
}

export interface WebSocketOptions {
  tlsOptions?: TLSOptions;
}

export interface AttachStreamOptions extends ProcessorOptions {
  sendMetadataOverWebsocket?: boolean;
  tlsOptions?: TLSOptions;
}
