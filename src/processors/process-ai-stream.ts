import WebSocket from 'ws';
import { LLMMetadata, ProcessorOptions, TextDataStream } from '../interfaces';
import { processT140BackspaceChars } from '../utils/backspace-processing';
import { WS_SERVER_PORT } from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';

/**
 * Create a WebSocket connection that can be used for T.140 transport
 *
 * @param websocketUrl The WebSocket URL to connect to
 * @param options Connection options including TLS settings
 * @returns WebSocket instance and a setup function to attach a stream
 */
export function createT140WebSocketConnection(
  websocketUrl: string = `ws://localhost:${WS_SERVER_PORT}`,
  options: {
    tlsOptions?: {
      rejectUnauthorized?: boolean;
      ca?: string;
      cert?: string;
      key?: string;
    };
  } = {}
): {
  connection: WebSocket;
  attachStream: (
    stream: TextDataStream,
    processorOptions?: ProcessorOptions
  ) => void;
} {
  // Setup WebSocket connection with TLS options if provided and URL is WSS
  const isSecure = websocketUrl.startsWith('wss://');
  const wsOptions: WebSocket.ClientOptions = {};

  // If this is a secure connection and TLS options are provided
  if (isSecure && options.tlsOptions) {
    wsOptions.rejectUnauthorized =
      options.tlsOptions.rejectUnauthorized !== false;

    // Add CA certificate if provided
    if (options.tlsOptions.ca) {
      wsOptions.ca = options.tlsOptions.ca;
    }

    // Add client certificate and key if provided
    if (options.tlsOptions.cert && options.tlsOptions.key) {
      wsOptions.cert = options.tlsOptions.cert;
      wsOptions.key = options.tlsOptions.key;
    }
  }

  const ws = new WebSocket(websocketUrl, wsOptions);
  let isConnected = false;

  ws.on('open', () => {
    isConnected = true;
  });

  // Function to attach a stream to this connection
  const attachStream = (
    stream: TextDataStream,
    processorOptions: ProcessorOptions = {}
  ) => {
    let buffer = '';
    let textBuffer = ''; // Buffer to track accumulated text for backspace handling
    const processBackspaces = processorOptions.processBackspaces === true;
    const handleMetadata = processorOptions.handleMetadata !== false; // Default to true
    const sendMetadataOverWebsocket =
      processorOptions.sendMetadataOverTransport === true; // Default to false

    // If the WebSocket is already connected, update connection state
    if (ws.readyState === WebSocket.OPEN) {
      isConnected = true;
    }

    // If the connection is already open and we have buffered content, send it
    ws.on('open', () => {
      isConnected = true;
      // Send any buffered content
      if (buffer) {
        ws.send(buffer);
        buffer = '';
      }
    });

    // Process the AI stream and send chunks through WebSocket
    stream.on('data', (chunk) => {
      // Extract both text content and metadata from the chunk
      const { text, metadata } = extractTextFromChunk(chunk);

      // If metadata is present and handling is enabled
      if (handleMetadata && metadata) {
        // Emit metadata event for external handling
        stream.emit('metadata', metadata);

        // Call metadata callback if provided
        if (
          processorOptions.metadataCallback &&
          typeof processorOptions.metadataCallback === 'function'
        ) {
          processorOptions.metadataCallback(metadata);
        }

        // Optionally send metadata over WebSocket as JSON
        if (sendMetadataOverWebsocket && isConnected) {
          const metadataPacket = JSON.stringify({
            type: 'metadata',
            content: metadata,
          });
          ws.send(metadataPacket);
        }
      }

      // Skip if no text content
      if (!text) return;

      let textToSend = text;

      if (processBackspaces) {
        // Process backspaces in the T.140 stream
        const { processedText, updatedBuffer } = processT140BackspaceChars(
          text,
          textBuffer
        );
        textBuffer = updatedBuffer;
        textToSend = processedText;

        // Skip if nothing to send
        if (!textToSend) return;
      }

      if (isConnected) {
        ws.send(textToSend);
      } else {
        // Buffer content until WebSocket is open
        buffer += textToSend;
      }
    });

    stream.on('end', () => {
      // Close the WebSocket connection when stream ends
      if (isConnected) {
        ws.close();
      }
    });

    stream.on('error', (err) => {
      console.error('AI Stream error:', err);
      if (isConnected) {
        ws.close();
      }
    });
  };

  return {
    attachStream,
    connection: ws,
  };
}

/**
 * Process an AI stream and send chunks through WebSocket to T.140
 * Supports both secure (wss://) and non-secure (ws://) WebSocket connections
 *
 * @param stream The AI stream to process
 * @param websocketUrl The WebSocket URL to connect to
 * @param options Configuration options
 * @param existingConnection Optional existing WebSocket connection to use
 * @returns The WebSocket connection being used
 */
export function processAIStream(
  stream: TextDataStream,
  websocketUrl: string = `ws://localhost:${WS_SERVER_PORT}`,
  options: {
    processBackspaces?: boolean;
    handleMetadata?: boolean;
    metadataCallback?: (metadata: LLMMetadata) => void;
    sendMetadataOverWebsocket?: boolean;
    preCreateConnection?: boolean;
    tlsOptions?: {
      rejectUnauthorized?: boolean; // Whether to reject connections with invalid certificates
      ca?: string; // Optional CA certificate content for validation
      cert?: string; // Optional client certificate content
      key?: string; // Optional client private key content
    };
  } = {},
  existingConnection?: WebSocket
): WebSocket {
  // If an existing connection is provided, use it
  if (existingConnection) {
    // Create a connection manager and attach the stream
    const processorOptionsExisting: ProcessorOptions = {
      processBackspaces: options.processBackspaces,
      handleMetadata: options.handleMetadata,
      metadataCallback: options.metadataCallback,
      sendMetadataOverTransport: options.sendMetadataOverWebsocket,
    };

    const { attachStream } = createT140WebSocketConnection(websocketUrl, {
      tlsOptions: options.tlsOptions,
    });

    attachStream(stream, processorOptionsExisting);

    return existingConnection;
  }

  // Otherwise, create a new connection
  const { connection, attachStream } = createT140WebSocketConnection(
    websocketUrl,
    {
      tlsOptions: options.tlsOptions,
    }
  );

  // Attach the stream to the connection
  const processorOptions: ProcessorOptions = {
    processBackspaces: options.processBackspaces,
    handleMetadata: options.handleMetadata,
    metadataCallback: options.metadataCallback,
    sendMetadataOverTransport: options.sendMetadataOverWebsocket,
  };

  attachStream(stream, processorOptions);

  return connection;
}
