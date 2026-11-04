import createDebug from 'debug';
import * as fs from 'fs';
import * as https from 'https';
import * as net from 'net';
import WebSocket from 'ws';
import { createRtpPacket } from '../rtp/create-rtp-packet';
import { createT140Clock } from '../rtp/t140-clock';
import {
  RTP_MAX_SEQUENCE_NUMBER,
  SEQPACKET_SOCKET_PATH,
  WS_SERVER_PORT,
} from '../utils/constants';
import { generateSecureSSRC } from '../utils/security';

const debug = createDebug('t140llm:websocket');

/** Largest WebSocket message accepted from a client, in bytes. */
const MAX_MESSAGE_BYTES = 64 * 1024;
/** Packets queued per connection while the backend socket is still connecting. */
const MAX_PENDING_PACKETS = 1000;

/**
 * WebSocket server configuration options
 */
export interface WebSocketServerOptions {
  port?: number;
  /** Interface to listen on. Default 127.0.0.1: the relay has no authentication. */
  host?: string;
  tls?: {
    cert: string;   // Path to certificate file
    key: string;    // Path to private key file
    ca?: string;    // Optional path to CA certificate
  };
}

function readPem(path: string, what: string): string {
  const pem = fs.readFileSync(path, 'utf8');
  if (!pem.includes('-----BEGIN')) {
    throw new Error(`TLS ${what} must be in PEM format. Refusing to start insecure server.`);
  }
  return pem;
}

function messageToString(message: WebSocket.Data): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return Buffer.concat(message).toString('utf-8');
  return Buffer.from(message as ArrayBuffer).toString('utf-8');
}

/**
 * Start a WebSocket server that frames every incoming text message as one
 * text/t140 RTP packet and writes it to the local SEQPACKET socket.
 *
 * Each WebSocket connection is one RTP stream: its own SSRC, sequence counter,
 * and 1000 Hz clock (RFC 4103 §3). With `tls` the server refuses to start
 * unless the certificate files are PEM.
 */
export function createWebSocketServer(options: WebSocketServerOptions = {}): WebSocket.Server {
  const port = options.port || WS_SERVER_PORT;
  const host = options.host ?? '127.0.0.1';
  let server: WebSocket.Server;

  if (options.tls) {
    const httpsOptions: https.ServerOptions = {
      cert: readPem(options.tls.cert, 'certificate'),
      key: readPem(options.tls.key, 'private key'),
    };
    if (options.tls.ca) {
      httpsOptions.ca = readPem(options.tls.ca, 'CA certificate');
    }

    const httpsServer = https.createServer(httpsOptions);
    server = new WebSocket.Server({ server: httpsServer, maxPayload: MAX_MESSAGE_BYTES });
    httpsServer.listen(port, host, () => {
      debug(`WebSocket Secure (WSS) server is running on wss://${host}:${port}`);
    });
  } else {
    server = new WebSocket.Server({ port, host, maxPayload: MAX_MESSAGE_BYTES });
    debug(`WebSocket server is running on ws://${host}:${port}`);
  }

  server.on('connection', (ws, req) => {
    req.socket?.setNoDelay(true);

    const seqpacketSocket = net.createConnection(SEQPACKET_SOCKET_PATH);
    const ssrc = generateSecureSSRC();
    const clock = createT140Clock();
    let sequenceNumber = 0;
    let socketReady = false;
    const pendingPackets: Buffer[] = [];

    seqpacketSocket.on('connect', () => {
      socketReady = true;
      for (const packet of pendingPackets) {
        seqpacketSocket.write(packet);
      }
      pendingPackets.length = 0;
    });

    seqpacketSocket.on('error', (err) => {
      debug('SEQPACKET socket error: %O', err);
      ws.close(1011, 'Backend socket error');
    });

    ws.on('error', (err) => {
      debug('WebSocket client error: %O', err);
      seqpacketSocket.destroy();
    });

    ws.on('message', (message: WebSocket.Data) => {
      const rtpPacket = createRtpPacket(
        sequenceNumber, clock.next(), messageToString(message), { ssrc }
      );
      sequenceNumber = (sequenceNumber + 1) % RTP_MAX_SEQUENCE_NUMBER;

      if (socketReady) {
        seqpacketSocket.write(rtpPacket);
      } else if (pendingPackets.length < MAX_PENDING_PACKETS) {
        pendingPackets.push(rtpPacket);
      } else {
        ws.close(1013, 'Backend not ready');
      }
    });

    ws.on('close', () => {
      seqpacketSocket.end();
    });
  });

  return server;
}
