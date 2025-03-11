import WebSocket from 'ws';
import { TextDataStream } from '../interfaces';
import { processT140BackspaceChars } from '../utils/backspace-processing';
import { WS_SERVER_PORT } from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';

/**
 * Process an AI stream and send chunks through WebSocket to T.140
 * Supports both secure (wss://) and non-secure (ws://) WebSocket connections
 */
export function processAIStream(
  stream: TextDataStream,
  websocketUrl: string = `ws://localhost:${WS_SERVER_PORT}`,
  options: {
    processBackspaces?: boolean,
    tlsOptions?: {
      rejectUnauthorized?: boolean,    // Whether to reject connections with invalid certificates
      ca?: string,                     // Optional CA certificate content for validation
      cert?: string,                   // Optional client certificate content
      key?: string                     // Optional client private key content
    }
  } = {}
): void {
  // Setup WebSocket connection with TLS options if provided and URL is WSS
  const isSecure = websocketUrl.startsWith('wss://');
  const wsOptions: WebSocket.ClientOptions = {};

  // If this is a secure connection and TLS options are provided
  if (isSecure && options.tlsOptions) {
    wsOptions.rejectUnauthorized = options.tlsOptions.rejectUnauthorized !== false;

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
  let buffer = '';
  let isConnected = false;
  let textBuffer = ''; // Buffer to track accumulated text for backspace handling
  const processBackspaces = options.processBackspaces === true;

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
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
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
}
