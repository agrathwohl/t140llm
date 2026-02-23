import * as fs from 'fs';
import * as https from 'https';
import * as net from 'net';
import WebSocket from 'ws';
import createDebug from 'debug';
import { createRtpPacket } from '../rtp/create-rtp-packet';
import {
  DEFAULT_TIMESTAMP_INCREMENT,
  RTP_MAX_SEQUENCE_NUMBER,
  SEQPACKET_SOCKET_PATH,
  WS_SERVER_PORT,
} from '../utils/constants';

const debug = createDebug('t140llm:websocket');
/**
 * Interface for WebSocket server configuration options
 */
export interface WebSocketServerOptions {
  port?: number;
  tls?: {
    cert: string;   // Path to certificate file
    key: string;    // Path to private key file
    ca?: string;    // Optional path to CA certificate
  };
}

/**
 * Create and initialize a WebSocket server with optional TLS support
 */
export function createWebSocketServer(options: WebSocketServerOptions = {}): WebSocket.Server {
  const port = options.port || WS_SERVER_PORT;
  let server: WebSocket.Server;

  // If TLS options are provided, create a secure server
  if (options.tls) {
    // Read and validate certificate files — failure throws, no insecure fallback
    const cert = fs.readFileSync(options.tls.cert, 'utf8');
    const key = fs.readFileSync(options.tls.key, 'utf8');

    if (!cert.includes('-----BEGIN CERTIFICATE-----')) {
      throw new Error('TLS certificate must be in PEM format. Refusing to start insecure server.');
    }
    if (!key.includes('-----BEGIN')) {
      throw new Error('TLS private key must be in PEM format. Refusing to start insecure server.');
    }

    const httpsOptions: https.ServerOptions = { cert, key };

    // Add CA certificate if provided
    if (options.tls.ca) {
      const ca = fs.readFileSync(options.tls.ca, 'utf8');
      if (!ca.includes('-----BEGIN')) {
        throw new Error('TLS CA certificate must be in PEM format. Refusing to start insecure server.');
      }
      httpsOptions.ca = ca;
    }

    // Create HTTPS server
    const httpsServer = https.createServer(httpsOptions);

    // Create secure WebSocket server using the HTTPS server
    server = new WebSocket.Server({ server: httpsServer });

    // Start HTTPS server
    httpsServer.listen(port, () => {
      debug(`WebSocket Secure (WSS) server is running on wss://localhost:${port}`);
    });
  } else {
    // Create standard non-secure WebSocket server
    server = new WebSocket.Server({ port });
    debug(`WebSocket server is running on ws://localhost:${port}`);
  }

  // Set up connection handler
  server.on('connection', (ws) => {
    // Create Unix SEQPACKET socket with proper connection and error handling
    const seqpacketSocket = net.createConnection(SEQPACKET_SOCKET_PATH);

    let sequenceNumber = 0;
    let timestamp = 0;
    let socketReady = false;
    const pendingMessages: Buffer[] = [];

    seqpacketSocket.on('connect', () => {
      socketReady = true;
      // Flush any messages queued before connection was established
      for (const msg of pendingMessages) {
        seqpacketSocket.write(msg);
      }
      pendingMessages.length = 0;
    });

    seqpacketSocket.on('error', (err) => {
      debug('SEQPACKET socket error: %O', err);
      ws.close(1011, 'Backend socket error');
    });

    ws.on('message', (message: string) => {
      // Create RTP packet with T.140 payload
      const rtpPacket = createRtpPacket(sequenceNumber, timestamp, message);

      if (socketReady) {
        // Send RTP packet through Unix SEQPACKET socket
        seqpacketSocket.write(rtpPacket);
      } else {
        // Queue until socket is connected
        pendingMessages.push(rtpPacket);
      }

      // Update sequence number and timestamp (wrap at 16-bit boundary per RTP spec)
      sequenceNumber = (sequenceNumber + 1) % RTP_MAX_SEQUENCE_NUMBER;
      timestamp = (timestamp + DEFAULT_TIMESTAMP_INCREMENT) >>> 0; // Wrap at 32-bit boundary per RTP spec
    });

    ws.on('close', () => {
      seqpacketSocket.end();
    });
  });

  return server;
}
