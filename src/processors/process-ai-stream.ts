import WebSocket from 'ws';
import { LLMMetadata, ProcessorOptions, TextDataStream } from '../interfaces';
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
  let isConnected = false;

  ws.on('open', () => {
    isConnected = true;
  });

  // Function to attach a stream to the WebSocket connection
  const attachStream = (
    stream: TextDataStream,
    processorOptions: AttachStreamOptions = {}
  ) => {
    let buffer = '';
    let textBuffer = '';
    const processBackspaces = processorOptions.processBackspaces === true;
    const handleMetadata = processorOptions.handleMetadata !== false;
    const sendMetadataOverWebsocket =
      processorOptions.sendMetadataOverWebsocket === true;

    if (ws.readyState === WebSocket.OPEN) {
      isConnected = true;
    }

    ws.on('open', () => {
      isConnected = true;
      if (buffer) {
        ws.send(buffer);
        buffer = '';
      }
    });

    stream.on('data', (chunk) => {
      const { text, metadata } = extractTextFromChunk(chunk);

      if (handleMetadata && metadata) {
        stream.emit('metadata', metadata);
        processorOptions.metadataCallback?.(metadata);

        if (sendMetadataOverWebsocket && isConnected) {
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

      if (isConnected) {
        ws.send(textToSend);
      } else {
        buffer += textToSend;
      }
    });

    stream.on('end', () => {
      if (isConnected) {
        ws.close();
      }
    });

    stream.on('error', (err) => {
      if (isConnected) {
        ws.close();
      }
    });
  };

  return { attachStream, connection: ws };
}

// Function to process an AI stream and attach it to a WebSocket connection
export function processAIStream(
  stream: TextDataStream,
  websocketUrl: string = `ws://localhost:${WS_SERVER_PORT}`,
  options: AttachStreamOptions = {},
  existingConnection?: WebSocket
): WebSocket {
  const processorOptions: ProcessorOptions = {
    processBackspaces: options.processBackspaces,
    handleMetadata: options.handleMetadata,
    metadataCallback: options.metadataCallback,
    sendMetadataOverTransport: options.sendMetadataOverWebsocket,
  };

  if (existingConnection) {
    const { attachStream } = createWebSocketConnection(websocketUrl, {
      tlsOptions: options.tlsOptions,
    });
    attachStream(stream, processorOptions);
    return existingConnection;
  }

  const { connection, attachStream } = createWebSocketConnection(websocketUrl, {
    tlsOptions: options.tlsOptions,
  });
  attachStream(stream, processorOptions);
  return connection;
}
