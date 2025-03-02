import * as dgram from 'dgram';
import type { EventEmitter } from 'events';
import * as net from 'net';
import WebSocket from 'ws';

// Import werift-rtp using require to avoid TypeScript errors
// @ts-ignore
// tslint:disable-next-line:no-var-requires
const weriftRtp = require('werift-rtp');
const { SrtpSession, SrtpPolicy, SrtpContext } = weriftRtp;

// WebSocket server address and port
const WS_SERVER_PORT = 8765;

// Unix SEQPACKET socket path
const SEQPACKET_SOCKET_PATH = '/tmp/seqpacket_socket';

// RTP/SRTP defaults
const RTP_HEADER_SIZE = 12;
const DEFAULT_RTP_PORT = 5004;
const DEFAULT_SRTP_PORT = 5006;
const DEFAULT_T140_PAYLOAD_TYPE = 96;
const DEFAULT_SSRC = 12345;

// Interface for any streaming data source
interface TextDataStream extends EventEmitter {
  on(event: 'data', listener: (data: any) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// Interface for RTP/SRTP configuration
interface RtpConfig {
  payloadType?: number;
  ssrc?: number;
  initialSequenceNumber?: number;
  initialTimestamp?: number;
  timestampIncrement?: number;
}

// Interface for SRTP specific configuration
interface SrtpConfig extends RtpConfig {
  masterKey: Buffer;
  masterSalt: Buffer;
  profile?: number; // Default: SRTP_AES128_CM_HMAC_SHA1_80
  isSRTCP?: boolean; // Default: false
}

// We now have proper types from our declaration file

/**
 * Function to create RTP packet with T.140 payload
 */
function createRtpPacket(
  sequenceNumber: number,
  timestamp: number,
  payload: string,
  options: Partial<RtpConfig> = {}
): Buffer {
  const version = 2;
  const padding = 0;
  const extension = 0;
  const csrcCount = 0;
  const marker = 0;
  const payloadType = options.payloadType || DEFAULT_T140_PAYLOAD_TYPE;
  const ssrc = options.ssrc || DEFAULT_SSRC;

  const rtpHeader = Buffer.alloc(RTP_HEADER_SIZE);
  // Use a different approach to avoid bitwise operations
  rtpHeader.writeUInt8(
    version * 64 + padding * 32 + extension * 16 + csrcCount,
    0
  );
  rtpHeader.writeUInt8(marker * 128 + payloadType, 1);
  rtpHeader.writeUInt16BE(sequenceNumber, 2);
  rtpHeader.writeUInt32BE(timestamp, 4);
  rtpHeader.writeUInt32BE(ssrc, 8);

  const payloadBuffer = Buffer.from(payload, 'utf-8');
  return Buffer.concat([rtpHeader, payloadBuffer]);
}

// Helper function to extract text content from various stream data formats
function extractTextFromChunk(chunk: any): string {
  // Handle Vercel AI SDK format
  if (chunk?.choices?.[0]?.delta?.content !== undefined) {
    return chunk.choices[0].delta.content;
  }
  // Handle OpenAI API format
  if (chunk?.choices?.[0]?.text !== undefined) {
    return chunk.choices[0].text;
  }
  // Handle Anthropic API format
  if (chunk?.delta?.text !== undefined) {
    return chunk.delta.text;
  }
  if (chunk?.content?.[0]?.text !== undefined) {
    return chunk.content[0].text;
  }
  // Handle simple string format
  if (typeof chunk === 'string') {
    return chunk;
  }
  // Handle other object with toString
  if (chunk && typeof chunk.toString === 'function') {
    return chunk.toString();
  }

  return '';
}

/**
 * Class to manage RTP/SRTP connections for sending T.140 data
 */
class T140RtpTransport {
  private seqNum: number;
  private timestamp: number;
  private config: RtpConfig;
  private srtpSession?: any; // Use any for the SRTP session to avoid TypeScript errors
  private udpSocket: dgram.Socket;
  private remoteAddress: string;
  private remotePort: number;

  constructor(
    remoteAddress: string,
    remotePort: number = DEFAULT_RTP_PORT,
    config: RtpConfig = {}
  ) {
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    this.config = {
      payloadType: config.payloadType || DEFAULT_T140_PAYLOAD_TYPE,
      ssrc: config.ssrc || DEFAULT_SSRC,
      initialSequenceNumber: config.initialSequenceNumber || 0,
      initialTimestamp: config.initialTimestamp || 0,
      timestampIncrement: config.timestampIncrement || 160, // 20ms at 8kHz
    };

    this.seqNum = this.config.initialSequenceNumber!;
    this.timestamp = this.config.initialTimestamp!;

    // Create UDP socket
    this.udpSocket = dgram.createSocket('udp4');
  }

  /**
   * Initialize and configure SRTP
   */
  setupSrtp(srtpConfig: SrtpConfig): void {
    // Create SRTP policy
    const policy = new SrtpPolicy();
    policy.ssrc = this.config.ssrc!;
    policy.key = srtpConfig.masterKey;
    policy.salt = srtpConfig.masterSalt;

    // If profile is specified, use it
    if (srtpConfig.profile) {
      policy.profile = srtpConfig.profile;
    }

    // Create SRTP context and session
    const context = new SrtpContext([policy]);
    this.srtpSession = new SrtpSession(context, srtpConfig.isSRTCP || false);
  }

  /**
   * Send text data as T.140 over RTP or SRTP
   */
  sendText(text: string): void {
    // Create RTP packet
    const rtpPacket = createRtpPacket(this.seqNum, this.timestamp, text, {
      payloadType: this.config.payloadType,
      ssrc: this.config.ssrc,
    });

    // Encrypt the packet if using SRTP
    let packet: Buffer;
    if (this.srtpSession) {
      // Use the typed protect method
      packet = this.srtpSession.protect(rtpPacket);
    } else {
      packet = rtpPacket;
    }

    // Send the packet
    this.udpSocket.send(
      packet,
      0,
      packet.length,
      this.remotePort,
      this.remoteAddress,
      (err) => {
        if (err) {
          console.error('Error sending RTP packet:', err);
        }
      }
    );

    // Update sequence number and timestamp for next packet
    // Use modulo to keep within 16-bit range
    // tslint:disable-next-line:no-bitwise
    this.seqNum = (this.seqNum + 1) & 0xFFFF;
    this.timestamp = this.timestamp + this.config.timestampIncrement!;
  }

  /**
   * Close the UDP socket
   */
  close(): void {
    this.udpSocket.close();
  }
}

// Create WebSocket server
const wss = new WebSocket.Server({ port: WS_SERVER_PORT });

wss.on('connection', (ws) => {
  // Create Unix SEQPACKET socket
  const seqpacketSocket = net.createConnection(SEQPACKET_SOCKET_PATH);

  let sequenceNumber = 0;
  let timestamp = 0;

  ws.on('message', (message: string) => {
    // Create RTP packet with T.140 payload
    const rtpPacket = createRtpPacket(sequenceNumber, timestamp, message);
    // Send RTP packet through Unix SEQPACKET socket
    seqpacketSocket.write(rtpPacket);

    // Update sequence number and timestamp
    sequenceNumber += 1;
    timestamp += 160; // Assuming 20ms per packet at 8kHz
  });

  ws.on('close', () => {
    seqpacketSocket.end();
  });
});

/**
 * Process an AI stream and send chunks through WebSocket to T.140
 */
function processAIStream(
  stream: TextDataStream,
  websocketUrl: string = `ws://localhost:${WS_SERVER_PORT}`
): void {
  const ws = new WebSocket(websocketUrl);
  let buffer = '';
  let isConnected = false;

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

    if (isConnected) {
      ws.send(text);
    } else {
      // Buffer content until WebSocket is open
      buffer += text;
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

/**
 * Process an AI stream and send chunks directly as T.140 over RTP
 */
function processAIStreamToRtp(
  stream: TextDataStream,
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  rtpConfig: RtpConfig = {}
): T140RtpTransport {
  const transport = new T140RtpTransport(remoteAddress, remotePort, rtpConfig);

  // Process the AI stream and send chunks over RTP
  stream.on('data', (chunk) => {
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
    if (!text) return;

    transport.sendText(text);
  });

  stream.on('end', () => {
    // Close the transport when stream ends
    transport.close();
  });

  stream.on('error', (err) => {
    console.error('AI Stream error:', err);
    transport.close();
  });

  return transport;
}

/**
 * Process an AI stream and send chunks directly as T.140 over SRTP
 */
function processAIStreamToSrtp(
  stream: TextDataStream,
  remoteAddress: string,
  srtpConfig: SrtpConfig,
  remotePort: number = DEFAULT_SRTP_PORT
): T140RtpTransport {
  // Create transport
  const transport = new T140RtpTransport(remoteAddress, remotePort, srtpConfig);

  // Setup SRTP
  transport.setupSrtp(srtpConfig);

  // Process the AI stream and send chunks over SRTP
  stream.on('data', (chunk) => {
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
    if (!text) return;

    transport.sendText(text);
  });

  stream.on('end', () => {
    // Close the transport when stream ends
    transport.close();
  });

  stream.on('error', (err) => {
    console.error('AI Stream error:', err);
    transport.close();
  });

  return transport;
}

/**
 * Helper function to create SRTP key and salt from a passphrase
 */
function createSrtpKeysFromPassphrase(
  passphrase: string
): { masterKey: Buffer; masterSalt: Buffer } {
  // Simple implementation - in production, use a more secure key derivation
  const passphraseBuffer = Buffer.from(passphrase);
  const masterKey = Buffer.alloc(16); // 128 bits
  const masterSalt = Buffer.alloc(14); // 112 bits

  // Fill the key and salt with the passphrase (cyclic if needed)
  // tslint:disable-next-line:no-increment-decrement
  for (let i = 0; i < masterKey.length; i += 1) {
    masterKey[i] = passphraseBuffer[i % passphraseBuffer.length];
  }

  // tslint:disable-next-line:no-increment-decrement
  for (let i = 0; i < masterSalt.length; i += 1) {
    masterSalt[i] = passphraseBuffer[(i + masterKey.length) % passphraseBuffer.length];
  }

  return { masterKey, masterSalt };
}

console.log(`WebSocket server is running on ws://localhost:${WS_SERVER_PORT}`);

export {
  wss,
  createRtpPacket,
  SEQPACKET_SOCKET_PATH,
  processAIStream,
  processAIStreamToRtp,
  processAIStreamToSrtp,
  createSrtpKeysFromPassphrase,
  T140RtpTransport
};
