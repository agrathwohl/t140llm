import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import WebSocket from 'ws';
import { createRtpPacket } from '../rtp/create-rtp-packet';
import { RTP_MAX_SEQUENCE_NUMBER, SEQPACKET_SOCKET_PATH, WS_SERVER_PORT } from '../utils/constants';

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
    try {
      // Read certificate files
      const httpsOptions = {
        cert: fs.readFileSync(options.tls.cert),
        key: fs.readFileSync(options.tls.key),
      };

      // Add CA certificate if provided
      if (options.tls.ca) {
        httpsOptions.ca = fs.readFileSync(options.tls.ca);
      }

      // Create HTTPS server
      const httpsServer = https.createServer(httpsOptions);

      // Create secure WebSocket server using the HTTPS server
      server = new WebSocket.Server({ server: httpsServer });

      // Start HTTPS server
      httpsServer.listen(port, () => {
        console.log(`WebSocket Secure (WSS) server is running on wss://localhost:${port}`);
      });
    } catch (err) {
      console.error('Failed to initialize secure WebSocket server:', err);
      // Fall back to non-secure WebSocket server
      console.warn('Falling back to non-secure WebSocket server');
      server = new WebSocket.Server({ port });
      console.log(`WebSocket server is running on ws://localhost:${port}`);
    }
  } else {
    // Create standard non-secure WebSocket server
    server = new WebSocket.Server({ port });
    console.log(`WebSocket server is running on ws://localhost:${port}`);
  }

  // Set up connection handler
  server.on('connection', (ws) => {
    // Create Unix SEQPACKET socket
    const seqpacketSocket = net.createConnection(SEQPACKET_SOCKET_PATH);

    let sequenceNumber = 0;
    let timestamp = 0;

    ws.on('message', (message: string) => {
      // Create RTP packet with T.140 payload
      const rtpPacket = createRtpPacket(sequenceNumber, timestamp, message);
      // Send RTP packet through Unix SEQPACKET socket
      seqpacketSocket.write(rtpPacket);

      // Update sequence number and timestamp (wrap at 16-bit boundary per RTP spec)
      sequenceNumber = (sequenceNumber + 1) % RTP_MAX_SEQUENCE_NUMBER;
      timestamp += 160; // Assuming 20ms per packet at 8kHz
    });

    ws.on('close', () => {
      seqpacketSocket.end();
    });
  });

  return server;
}
