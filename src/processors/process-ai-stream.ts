import createDebug from 'debug';
import WebSocket from 'ws';
import { AttachStreamOptions, TextDataStream, WebSocketOptions } from '../interfaces';
import { WS_SERVER_PORT } from '../utils/constants';
import {
  attachStreamProcessor,
  resolveStreamOptions,
} from '../utils/stream-processor';

const debug = createDebug('t140llm:websocket-client');

function isWebSocketConnected(ws: WebSocket): boolean {
  return ws.readyState === WebSocket.OPEN;
}

/**
 * Attach a stream to an existing WebSocket connection. Text is sent as
 * WebSocket text frames; text that arrives before the socket opens is
 * buffered and flushed on 'open'.
 *
 * @param ws The WebSocket connection to attach the stream to
 * @param stream The stream to attach
 * @param processorOptions Processor options for handling the stream
 */
export function attachStreamToWebSocket(
  ws: WebSocket,
  stream: TextDataStream,
  processorOptions: AttachStreamOptions = {}
): void {
  let buffer = '';
  let ended = false;

  ws.on('error', (err) => processorOptions.onError?.(err));
  ws.on('open', () => {
    const sock = (ws as any)._socket;
    if (sock && typeof sock.setNoDelay === 'function') {
      sock.setNoDelay(true);
    }
    if (buffer) {
      const dataToSend = buffer;
      buffer = '';
      ws.send(dataToSend);
    }
    if (ended) {
      ws.close();
    }
  });

  const options = resolveStreamOptions(processorOptions, {
    sendMetadataOverTransport: processorOptions.sendMetadataOverWebsocket,
  });

  attachStreamProcessor(stream, options, {
    sendText: (text) => {
      if (isWebSocketConnected(ws)) {
        ws.send(text);
      } else {
        buffer += text;
      }
    },
    sendMetadata: (metadata) => {
      if (isWebSocketConnected(ws)) {
        ws.send(JSON.stringify({ type: 'metadata', content: metadata }));
      }
    },
    close: () => {
      ended = true;
      if (isWebSocketConnected(ws)) {
        ws.close();
      }
    },
  });
}

/**
 * Open a WebSocket connection that streams can be attached to later.
 *
 * @param websocketUrl ws:// or wss:// URL (default ws://localhost:8765)
 * @param options TLS options for wss:// URLs
 */
export function createT140WebSocketTransport(
  websocketUrl: string = `ws://localhost:${WS_SERVER_PORT}`,
  options: WebSocketOptions = {}
): {
  connection: WebSocket;
  attachStream: (
    stream: TextDataStream,
    processorOptions?: AttachStreamOptions
  ) => void;
} {
  const isSecure = websocketUrl.startsWith('wss://');
  if (options.tlsOptions && !isSecure) {
    throw new Error('tlsOptions require a wss:// URL');
  }
  const wsOptions: WebSocket.ClientOptions =
    isSecure && options.tlsOptions
      ? {
        rejectUnauthorized: options.tlsOptions.rejectUnauthorized !== false,
        ca: options.tlsOptions.ca,
        cert: options.tlsOptions.cert,
        key: options.tlsOptions.key,
      }
      : {};

  const ws = new WebSocket(websocketUrl, wsOptions);
  // The connection is opened before any stream is attached, so handle its
  // errors here. Without this a refused connection would exit the process.
  ws.on('error', (err) => debug('connection error: %O', err));

  return {
    connection: ws,
    attachStream: (stream, processorOptions = {}) => {
      attachStreamToWebSocket(ws, stream, processorOptions);
    },
  };
}

/** @deprecated Use createT140WebSocketTransport instead */
export const createWebSocketConnection = createT140WebSocketTransport;

/**
 * Stream an LLM response as text over a WebSocket.
 *
 * @param stream The AI stream to process
 * @param websocketUrl ws:// or wss:// URL (default ws://localhost:8765)
 * @param options Processor and TLS options
 * @param existingConnection Optional open WebSocket to reuse
 * @returns The WebSocket in use
 */
export function processAIStream(
  stream: TextDataStream,
  websocketUrl: string = `ws://localhost:${WS_SERVER_PORT}`,
  options: AttachStreamOptions = {},
  existingConnection?: WebSocket
): WebSocket {
  if (existingConnection) {
    attachStreamToWebSocket(existingConnection, stream, options);
    return existingConnection;
  }

  const { connection, attachStream } = createT140WebSocketTransport(websocketUrl, {
    tlsOptions: options.tlsOptions,
  });
  attachStream(stream, options);
  return connection;
}
