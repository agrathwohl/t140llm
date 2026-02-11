import WebSocket from 'ws';
import { ProcessorOptions, TextDataStream } from '../interfaces';
import { processT140BackspaceChars } from '../utils/backspace-processing';
import { WS_SERVER_PORT } from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';

// Interface for TLS options
interface TLSOptions {
  rejectUnauthorized?: boolean;
  ca?: string;
  cert?: string;
  key?: string;
}

// Interface for WebSocket options
interface WebSocketOptions {
  tlsOptions?: TLSOptions;
}

// Interface for options when attaching a stream
interface AttachStreamOptions extends ProcessorOptions {
  sendMetadataOverWebsocket?: boolean;
  tlsOptions?: TLSOptions;
}

// Function to check if WebSocket is connected
function isWebSocketConnected(ws: WebSocket): boolean {
  return ws.readyState === WebSocket.OPEN;
}

// Function to create a WebSocket connection
export function createWebSocketConnection(
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
  let buffer = '';
  let bufferLock = false;

  // Flush buffer when connection opens
  ws.on('open', () => {
    if (buffer && !bufferLock) {
      bufferLock = true;
      const dataToSend = buffer;
      buffer = '';
      ws.send(dataToSend);
      bufferLock = false;
    }
  });

  // Function to attach a stream to the WebSocket connection
  const attachStream = (
    stream: TextDataStream,
    processorOptions: AttachStreamOptions = {}
  ) => {
    let textBuffer = '';
    const processBackspaces = processorOptions.processBackspaces === true;
    const handleMetadata = processorOptions.handleMetadata !== false;
    const sendMetadataOverWebsocket =
      processorOptions.sendMetadataOverWebsocket === true;

    stream.on('data', (chunk) => {
      const { text, metadata } = extractTextFromChunk(chunk);

      if (handleMetadata && metadata) {
        stream.emit('metadata', metadata);
        processorOptions.metadataCallback?.(metadata);

        if (sendMetadataOverWebsocket && isWebSocketConnected(ws)) {
          ws.send(JSON.stringify({ type: 'metadata', content: metadata }));
        }
      }

      if (!text) return;

      let textToSend = text;

      if (processBackspaces) {
        const { processedText, updatedBuffer } = processT140BackspaceChars(
          text,
          textBuffer
        );
        textBuffer = updatedBuffer;
        textToSend = processedText;
        if (!textToSend) return;
      }

      // Use WebSocket's readyState directly to avoid race conditions
      if (isWebSocketConnected(ws)) {
        ws.send(textToSend);
      } else {
        // Atomic buffer update to prevent race conditions
        buffer += textToSend;
      }
    });

    stream.on('end', () => {
      if (isWebSocketConnected(ws)) {
        ws.close();
      }
    });

    stream.on('error', () => {
      if (isWebSocketConnected(ws)) {
        ws.close();
      }
    });
  };

  return { attachStream, connection: ws };
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
  let textBuffer = '';
  const processBackspaces = processorOptions.processBackspaces === true;
  const handleMetadata = processorOptions.handleMetadata !== false;
  const sendMetadataOverWebsocket =
    processorOptions.sendMetadataOverWebsocket === true;

  // Flush buffer when connection opens
  ws.on('open', () => {
    if (buffer) {
      const dataToSend = buffer;
      buffer = '';
      ws.send(dataToSend);
    }
  });

  stream.on('data', (chunk) => {
    const { text, metadata } = extractTextFromChunk(chunk);

    if (handleMetadata && metadata) {
      stream.emit('metadata', metadata);
      processorOptions.metadataCallback?.(metadata);

      if (sendMetadataOverWebsocket && isWebSocketConnected(ws)) {
        ws.send(JSON.stringify({ type: 'metadata', content: metadata }));
      }
    }

    if (!text) return;

    let textToSend = text;

    if (processBackspaces) {
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer
      );
      textBuffer = updatedBuffer;
      textToSend = processedText;
      if (!textToSend) return;
    }

    // Use WebSocket's readyState directly to avoid race conditions
    if (isWebSocketConnected(ws)) {
      ws.send(textToSend);
    } else {
      buffer += textToSend;
    }
  });

  stream.on('end', () => {
    if (isWebSocketConnected(ws)) {
      ws.close();
    }
  });

  stream.on('error', () => {
    if (isWebSocketConnected(ws)) {
      ws.close();
    }
  });
}

// Function to process an AI stream and attach it to a WebSocket connection
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
  };

  if (existingConnection) {
    // Attach stream directly to the existing connection
    attachStreamToWebSocket(existingConnection, stream, processorOptions);
    return existingConnection;
  }

  const { connection, attachStream } = createWebSocketConnection(websocketUrl, {
    tlsOptions: options.tlsOptions,
  });
  attachStream(stream, processorOptions);
  return connection;
}
