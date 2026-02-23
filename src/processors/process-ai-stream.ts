import WebSocket from 'ws';
import { AttachStreamOptions, TextDataStream, WebSocketOptions } from '../interfaces';
import { WS_SERVER_PORT } from '../utils/constants';
import {
  attachStreamProcessor,
  resolveStreamOptions,
} from '../utils/stream-processor';

function isWebSocketConnected(ws: WebSocket): boolean {
  return ws.readyState === WebSocket.OPEN;
}

/**
 * Attach a stream to an existing WebSocket connection
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

  ws.on('open', () => {
    if (buffer) {
      const dataToSend = buffer;
      buffer = '';
      ws.send(dataToSend);
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
      if (isWebSocketConnected(ws)) {
        ws.close();
      }
    },
  });
}

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

  const attachStream = (
    stream: TextDataStream,
    processorOptions: AttachStreamOptions = {}
  ) => {
    attachStreamToWebSocket(ws, stream, processorOptions);
  };

  return { attachStream, connection: ws };
}

/** @deprecated Use createT140WebSocketTransport instead */
export const createWebSocketConnection = createT140WebSocketTransport;

export function processAIStream(
  stream: TextDataStream,
  websocketUrl: string = `ws://localhost:${WS_SERVER_PORT}`,
  options: AttachStreamOptions = {},
  existingConnection?: WebSocket
): WebSocket {
  const processorOptions: AttachStreamOptions = {
    processBackspaces: options.processBackspaces,
    handleMetadata: options.handleMetadata,
    metadataCallback: options.metadataCallback,
    sendMetadataOverWebsocket: options.sendMetadataOverWebsocket,
    onError: options.onError,
  };

  if (existingConnection) {
    attachStreamToWebSocket(existingConnection, stream, processorOptions);
    return existingConnection;
  }

  const { connection, attachStream } = createT140WebSocketTransport(websocketUrl, {
    tlsOptions: options.tlsOptions,
  });
  attachStream(stream, processorOptions);
  return connection;
}
