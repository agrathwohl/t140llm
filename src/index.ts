import * as crypto from 'crypto';
import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import WebSocket from 'ws';

// Import werift-rtp using require to avoid TypeScript errors
// @ts-ignore
// tslint:disable-next-line:no-var-requires
const weriftRtp = require('werift-rtp');
const { SrtpSession, SrtpPolicy, SrtpContext } = weriftRtp;

// WebSocket server address and port
const WS_SERVER_PORT = 8765;

/**
 * Interface for WebSocket server configuration options
 */
interface WebSocketServerOptions {
  port?: number;
  tls?: {
    cert: string;   // Path to certificate file
    key: string;    // Path to private key file
    ca?: string;    // Optional path to CA certificate
  };
}

// Unix SEQPACKET socket path
const SEQPACKET_SOCKET_PATH = '/tmp/seqpacket_socket';

// RTP/SRTP defaults
const RTP_HEADER_SIZE = 12;
const DEFAULT_RTP_PORT = 5004;
const DEFAULT_SRTP_PORT = 5006;
const DEFAULT_T140_PAYLOAD_TYPE = 96;
// We'll generate SSRC securely at runtime, but keep this for backward compatibility
const LEGACY_DEFAULT_SSRC = 12345;
const DEFAULT_RED_PAYLOAD_TYPE = 98; // RED payload type for T.140 redundancy

/**
 * Generate a cryptographically secure random SSRC value
 * SSRC is a 32-bit unsigned integer (0 to 4,294,967,295)
 */
function generateSecureSSRC(): number {
  // Generate 4 random bytes and convert to a 32-bit unsigned integer
  const randomBytes = crypto.randomBytes(4);
  return randomBytes.readUInt32BE(0);
}

// T.140 constants
const BACKSPACE = '\u0008'; // ASCII backspace character (BS)

/**
 * Error types for T140RtpTransport
 */
enum T140RtpErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',       // UDP socket or network-related errors
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR', // SRTP encryption errors
  FEC_ERROR = 'FEC_ERROR',               // Forward Error Correction errors
  INVALID_CONFIG = 'INVALID_CONFIG',     // Invalid configuration errors
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR', // Rate limiting errors
  RESOURCE_ERROR = 'RESOURCE_ERROR',      // Resource allocation/deallocation errors
}

// Interface for any streaming data source
interface TextDataStream extends EventEmitter {
  on(event: 'data', listener: (data: any) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

/**
 * Interface for T140RtpTransport Error objects
 */
interface T140RtpError {
  type: T140RtpErrorType;
  message: string;
  cause?: Error;
}

// Interface for RTP/SRTP configuration
interface RtpConfig {
  payloadType?: number;
  ssrc?: number;
  initialSequenceNumber?: number;
  initialTimestamp?: number;
  timestampIncrement?: number;
  fecEnabled?: boolean;
  fecPayloadType?: number;
  fecGroupSize?: number; // Number of packets to protect with a single FEC packet
  processBackspaces?: boolean; // Enable T.140 backspace character processing
  charRateLimit?: number; // Character rate limit in characters per second
  redEnabled?: boolean; // Enable redundancy for T.140
  redPayloadType?: number; // Payload type for RED encoding
  redundancyLevel?: number; // Number of redundant T.140 blocks to include
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
  // Generate secure SSRC if not provided
  const ssrc = options.ssrc || generateSecureSSRC();

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
 *
 * Events:
 * - 'error': Emitted when an error occurs. Error object contains:
 *   - type: T140RtpErrorType - the type of error
 *   - message: string - human-readable error message
 *   - cause?: Error - original error that caused this error (if available)
 *
 * Error Types:
 * - NETWORK_ERROR: UDP socket or network-related errors
 *   - Occurs when sending packets fails due to network issues
 *   - Socket connection issues
 *
 * - ENCRYPTION_ERROR: SRTP encryption errors
 *   - Occurs when encryption or decryption fails
 *   - Key generation or management errors
 *
 * - FEC_ERROR: Forward Error Correction errors
 *   - Occurs when FEC packet creation fails
 *   - Invalid FEC parameters or configurations
 *
 * - INVALID_CONFIG: Invalid configuration errors
 *   - Occurs when the provided configuration is invalid
 *   - Missing required parameters
 *
 * - RATE_LIMIT_ERROR: Rate limiting errors
 *   - Occurs when rate limit handling encounters issues
 *
 * - RESOURCE_ERROR: Resource allocation/deallocation errors
 *   - Occurs during socket creation/closing
 *   - Memory allocation issues
 *
 * Example usage:
 * ```typescript
 * const transport = new T140RtpTransport('127.0.0.1', 5004);
 * transport.on('error', (err) => {
 *   console.error(`Error (${err.type}): ${err.message}`);
 *   // Handle specific error types
 *   if (err.type === T140RtpErrorType.NETWORK_ERROR) {
 *     // Handle network error
 *   }
 * });
 * ```
 */
class T140RtpTransport extends EventEmitter {
  private seqNum: number;
  private timestamp: number;
  private config: RtpConfig;
  private srtpSession?: any; // Use any for the SRTP session to avoid TypeScript errors
  private udpSocket: dgram.Socket;
  private remoteAddress: string;
  private remotePort: number;
  private packetBuffer: Buffer[] = []; // Buffer to store packets for FEC
  private packetSequenceNumbers: number[] = []; // Sequence numbers for FEC packets
  private packetTimestamps: number[] = []; // Timestamps for FEC packets
  private fecCounter: number = 0; // Counter for tracking when to send FEC packets
  private redPackets: Buffer[] = []; // Buffer to store packets for T.140 redundancy

  constructor(
    remoteAddress: string,
    remotePort: number = DEFAULT_RTP_PORT,
    config: RtpConfig = {}
  ) {
    super(); // Initialize EventEmitter

    // Validate remote address
    if (!remoteAddress) {
      throw new Error('Remote address is required');
    }

    // Basic validation of the remote address format
    // This performs basic IPv4 validation and rejects obviously invalid addresses
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(remoteAddress) &&
        remoteAddress !== 'localhost' &&
        !/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/.test(remoteAddress)) {
      throw new Error('Invalid remote address format');
    }

    // Validate port number is within valid range
    if (remotePort < 0 || remotePort > 65535) {
      throw new Error('Port number must be between 0 and 65535');
    }

    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    // Generate a secure random SSRC if not provided
    const secureSSRC = generateSecureSSRC();

    this.config = {
      payloadType: config.payloadType || DEFAULT_T140_PAYLOAD_TYPE,
      // Use provided SSRC (if any), otherwise use secure random SSRC
      ssrc: config.ssrc || secureSSRC,
      initialSequenceNumber: config.initialSequenceNumber || 0,
      initialTimestamp: config.initialTimestamp || 0,
      timestampIncrement: config.timestampIncrement || 160, // 20ms at 8kHz
      fecEnabled: config.fecEnabled || false,
      fecPayloadType: config.fecPayloadType || 97, // Default payload type for FEC
      fecGroupSize: config.fecGroupSize || 5, // Default: protect every 5 packets with 1 FEC packet
      charRateLimit: config.charRateLimit || 0, // 0 means no rate limit
      redEnabled: config.redEnabled || false, // Redundancy disabled by default
      redPayloadType: config.redPayloadType || DEFAULT_RED_PAYLOAD_TYPE,
      redundancyLevel: config.redundancyLevel || 2, // Default: 2 redundant blocks
    };

    this.seqNum = this.config.initialSequenceNumber!;
    this.timestamp = this.config.initialTimestamp!;

    // Create UDP socket
    try {
      this.udpSocket = dgram.createSocket('udp4');

      // Set up UDP socket error handler
      this.udpSocket.on('error', (err) => {
        this.emit('error', {
          type: T140RtpErrorType.NETWORK_ERROR,
          message: 'UDP socket error',
          cause: err,
        });
      });
    } catch (err) {
      throw new Error(`Failed to create UDP socket: ${err}`);
    }
  }

  /**
   * Initialize and configure SRTP
   */
  setupSrtp(srtpConfig: SrtpConfig): void {
    try {
      // Validate required keys
      if (!srtpConfig.masterKey || !srtpConfig.masterSalt) {
        this.emit('error', {
          type: T140RtpErrorType.INVALID_CONFIG,
          message: 'SRTP configuration missing required master key or salt',
        });
        return;
      }

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
    } catch (err) {
      this.emit('error', {
        type: T140RtpErrorType.ENCRYPTION_ERROR,
        message: 'Failed to initialize SRTP session',
        cause: err as Error,
      });
    }
  }

  /**
   * Create a Forward Error Correction (FEC) packet according to RFC 5109
   * Using XOR-based FEC for a group of RTP packets
   */
  private _createFecPacket(
    packets: Buffer[],
    sequenceNumbers: number[],
    timestamps: number[]
  ): Buffer {
    if (packets.length === 0) {
      this.emit('error', {
        type: T140RtpErrorType.FEC_ERROR,
        message: 'Cannot create FEC packet from empty packet list',
      });
      return Buffer.alloc(0);
    }

    // Verify that all array lengths match
    if (packets.length !== sequenceNumbers.length || packets.length !== timestamps.length) {
      this.emit('error', {
        type: T140RtpErrorType.FEC_ERROR,
        message: 'Mismatch in FEC packet parameters: packets, sequence numbers, and timestamps must have the same length',
      });
      return Buffer.alloc(0);
    }

    // We need to XOR all RTP headers and payloads
    // First, create the FEC header
    const version = 2;
    const padding = 0;
    const extension = 0;
    const csrcCount = 0;
    const marker = 0;
    const payloadType = this.config.fecPayloadType!;
    const ssrc = this.config.ssrc!;
    // Use the highest sequence number + 1 for the FEC packet
    const maxSeqNum = Math.max(...sequenceNumbers);
    const fecSeqNum = (maxSeqNum + 1) % 65536;
    // Use the highest timestamp for the FEC packet
    const fecTimestamp = Math.max(...timestamps);

    // Create the FEC RTP header
    const fecHeader = Buffer.alloc(RTP_HEADER_SIZE);
    fecHeader.writeUInt8(
      version * 64 + padding * 32 + extension * 16 + csrcCount,
      0
    );
    fecHeader.writeUInt8(marker * 128 + payloadType, 1);
    fecHeader.writeUInt16BE(fecSeqNum, 2);
    fecHeader.writeUInt32BE(fecTimestamp, 4);
    fecHeader.writeUInt32BE(ssrc, 8);

    // FEC Header Extension - RFC 5109 Section 6.1
    // 16 bytes of FEC header extension after the RTP header
    const fecHeaderExt = Buffer.alloc(16);
    // E bit: Extension bit (always 0 for simple XOR-based FEC)
    // L bit: Long mask bit (0 for now, fewer than 16 packets)
    // P bit: Protection length field present (0 for now)
    // X bit: Reserved (0)
    // CC bits: CSRC count from the FEC header
    // M bit: RTP marker bit state from the FEC header
    // PT bits: FEC payload type
    fecHeaderExt.writeUInt8(0, 0); // E, L, P, X, CC, M bits
    fecHeaderExt.writeUInt8(this.config.payloadType!, 1); // Original media PT
    // SN base: first sequence number this FEC packet protects
    fecHeaderExt.writeUInt16BE(sequenceNumbers[0], 2);
    // Timestamp recovery field: timestamp of the media packet
    fecHeaderExt.writeUInt32BE(timestamps[0], 4);
    // Length recovery field: length of the media packet
    const packetLength = packets[0].length;
    fecHeaderExt.writeUInt16BE(packetLength, 8);
    // Mask: which packets this FEC packet protects (bits)
    // For simplicity, we use a continuous block of packets
    // Each bit represents one packet being protected
    const mask = Buffer.alloc(2);
    // Set bits for each protected packet
    // For example: 0000 0000 0001 1111 would protect 5 consecutive packets
    mask.writeUInt16BE(Math.pow(2, packets.length) - 1, 0);
    mask.copy(fecHeaderExt, 10, 0, 2);

    // Now create the FEC payload
    // This requires XORing the payloads of all protected packets
    // First, find the largest packet to determine payload size
    const maxPayloadLength = Math.max(
      ...packets.map((p) => {
        return p.length - RTP_HEADER_SIZE;
      })
    );
    const fecPayload = Buffer.alloc(maxPayloadLength);

    // XOR all payloads together
    for (const packet of packets) {
      const payloadOffset = RTP_HEADER_SIZE;
      const payloadLength = packet.length - payloadOffset;
      for (let j = 0; j < payloadLength; j = j + 1) {
        // XOR byte-by-byte
        if (j < fecPayload.length) {
          // Use a non-bitwise approach
          // Split into two operations to avoid exceeding line length
          const xorResult = fecPayload[j] === packet[payloadOffset + j] ? 0 : 1;
          fecPayload[j] = fecPayload[j] ? xorResult : packet[payloadOffset + j];
        }
      }
    }

    // Combine FEC RTP header, FEC header extension, and FEC payload
    return Buffer.concat([fecHeader, fecHeaderExt, fecPayload]);
  }

  /**
   * Create a RED packet with redundancy according to RFC 2198
   */
  private _createRedPacket(
    primaryData: string,
    redundantPackets: Buffer[]
  ): Buffer {
    if (!this.config.redEnabled || redundantPackets.length === 0) {
      // If RED is not enabled or no redundant packets available,
      // just create a normal RTP packet
      return createRtpPacket(this.seqNum, this.timestamp, primaryData, {
        payloadType: this.config.payloadType,
        ssrc: this.config.ssrc,
      });
    }

    // Determine how many redundant packets to include
    // Limited by available packets and configured redundancy level
    const redundancyLevel = Math.min(
      redundantPackets.length,
      this.config.redundancyLevel || 2
    );

    // Start with RTP header
    const rtpHeader = Buffer.alloc(RTP_HEADER_SIZE);
    const version = 2;
    const padding = 0;
    const extension = 0;
    const csrcCount = 0;
    const marker = 0;
    const payloadType = this.config.redPayloadType!;
    const ssrc = this.config.ssrc!;

    // Create RTP header
    rtpHeader.writeUInt8(
      version * 64 + padding * 32 + extension * 16 + csrcCount,
      0
    );
    rtpHeader.writeUInt8(marker * 128 + payloadType, 1);
    rtpHeader.writeUInt16BE(this.seqNum, 2);
    rtpHeader.writeUInt32BE(this.timestamp, 4);
    rtpHeader.writeUInt32BE(ssrc, 8);

    // Create RED headers and payloads
    // Format for each redundant block:
    // 1 byte: F(1) + Block PT(7)
    // 2 bytes: Timestamp offset (uint16)
    // 1 byte: Block length (uint8)
    // For the primary data (last block):
    // 1 byte: F(0) + Block PT(7)

    // 4 bytes per redundant block + 1 for primary
    const redHeaders = Buffer.alloc(redundancyLevel * 4 + 1);
    let offset = 0;

    // Add headers for redundant blocks
    for (let i = 0; i < redundancyLevel; i = i + 1) {
      // Get the packet to include as redundant data
      // Most recent redundant packet first
      const packet = redundantPackets[redundantPackets.length - 1 - i];

      // Calculate timestamp offset (primary timestamp - redundant timestamp)
      // We need to extract the timestamp from the RTP header (bytes 4-7)
      const redPacketTimestamp = packet.readUInt32BE(4);
      // 16-bit value using modulo instead of bitwise AND
      const timestampOffset = (this.timestamp - redPacketTimestamp) % 65536;

      // Calculate payload length (packet length - RTP header size)
      const payloadLength = Math.min(packet.length - RTP_HEADER_SIZE, 255); // Max 8 bits

      // Write RED header for this block
      // F bit = 1 (more blocks follow)
      // Use 128 (0x80) + PT instead of bitwise OR
      redHeaders.writeUInt8(128 + this.config.payloadType!, offset); // F=1 + block PT
      redHeaders.writeUInt16BE(timestampOffset, offset + 1); // Timestamp offset
      redHeaders.writeUInt8(payloadLength, offset + 3); // Block length
      offset = offset + 4;
    }

    // Add header for primary data (F bit = 0, no timestamp offset, no length)
    redHeaders.writeUInt8(this.config.payloadType!, offset); // F=0 + block PT

    // Create primary data payload
    const primaryPayload = Buffer.from(primaryData, 'utf-8');

    // Combine all parts: RTP header + RED headers + redundant payloads + primary payload
    const buffers = [rtpHeader, redHeaders];

    // Add redundant payloads (skipping their RTP headers)
    for (let i = 0; i < redundancyLevel; i = i + 1) {
      const packet = redundantPackets[redundantPackets.length - 1 - i];
      const payload = packet.slice(RTP_HEADER_SIZE);
      buffers.push(payload);
    }

    // Add primary payload
    buffers.push(primaryPayload);

    // Combine all buffers
    return Buffer.concat(buffers);
  }

  /**
   * Send text data as T.140 over RTP or SRTP
   */
  sendText(text: string): void {
    // Check if we should use RED (redundancy) encoding
    let packet: Buffer;
    if (this.config.redEnabled && this.redPackets.length > 0) {
      // Create a RED packet with redundancy
      const redPacket = this._createRedPacket(text, this.redPackets);

      // Store the packet for future redundancy use
      const normalPacket = createRtpPacket(this.seqNum, this.timestamp, text, {
        payloadType: this.config.payloadType,
        ssrc: this.config.ssrc,
      });

      // Keep original non-RED packet for redundancy
      this.redPackets.push(Buffer.from(normalPacket));

      // Limit the number of stored packets
      if (this.redPackets.length > this.config.redundancyLevel!) {
        this.redPackets.shift(); // Remove oldest packet
      }

      packet = redPacket;
    } else {
      // Create normal RTP packet
      const rtpPacket = createRtpPacket(this.seqNum, this.timestamp, text, {
        payloadType: this.config.payloadType,
        ssrc: this.config.ssrc,
      });

      // Store for future redundancy use if RED is enabled
      if (this.config.redEnabled) {
        this.redPackets.push(Buffer.from(rtpPacket));

        // Limit the number of stored packets
        if (this.redPackets.length > this.config.redundancyLevel!) {
          this.redPackets.shift(); // Remove oldest packet
        }
      }

      packet = rtpPacket;
    }

    // Encrypt the packet if using SRTP
    let finalPacket: Buffer;
    try {
      if (this.srtpSession) {
        // Use the typed protect method
        finalPacket = this.srtpSession.protect(packet);
      } else {
        finalPacket = packet;
      }
    } catch (err) {
      this.emit('error', {
        type: T140RtpErrorType.ENCRYPTION_ERROR,
        message: 'Failed to encrypt packet with SRTP - packet not sent',
        cause: err as Error,
      });
      // Don't fall back to unencrypted - abort the send operation for security
      return;
    }

    // Send the packet
    this.udpSocket.send(
      finalPacket,
      0,
      finalPacket.length,
      this.remotePort,
      this.remoteAddress,
      (err) => {
        if (err) {
          this.emit('error', {
            type: T140RtpErrorType.NETWORK_ERROR,
            message: 'Failed to send RTP packet',
            cause: err,
          });
        }
      }
    );

    // If FEC is enabled, add this packet to the buffer for FEC calculation
    if (this.config.fecEnabled) {
      // Store original packet for FEC (non-RED packet for simplicity)
      const rtpPacket = createRtpPacket(this.seqNum, this.timestamp, text, {
        payloadType: this.config.payloadType,
        ssrc: this.config.ssrc,
      });

      this.packetBuffer.push(Buffer.from(rtpPacket)); // Make a copy of the packet
      this.packetSequenceNumbers.push(this.seqNum);
      this.packetTimestamps.push(this.timestamp);
      this.fecCounter += 1;

      // Check if we've reached the group size to send an FEC packet
      if (this.fecCounter >= this.config.fecGroupSize!) {
        // Create and send FEC packet
        const fecPacket = this._createFecPacket(
          this.packetBuffer,
          this.packetSequenceNumbers,
          this.packetTimestamps
        );

        // Only send if we have a valid FEC packet
        if (fecPacket.length > 0) {
          // Encrypt the FEC packet if using SRTP
          let finalFecPacket: Buffer;
          try {
            if (this.srtpSession) {
              finalFecPacket = this.srtpSession.protect(fecPacket);
            } else {
              finalFecPacket = fecPacket;
            }
          } catch (err) {
            this.emit('error', {
              type: T140RtpErrorType.ENCRYPTION_ERROR,
              message: 'Failed to encrypt FEC packet with SRTP - packet not sent',
              cause: err as Error,
            });
            // Don't fall back to unencrypted - abort the send operation for security
            return;
          }

          // Send the FEC packet
          this.udpSocket.send(
            finalFecPacket,
            0,
            finalFecPacket.length,
            this.remotePort,
            this.remoteAddress,
            (err) => {
              if (err) {
                this.emit('error', {
                  type: T140RtpErrorType.NETWORK_ERROR,
                  message: 'Failed to send FEC packet',
                  cause: err,
                });
              }
            }
          );
        }

        // Reset FEC counters and buffers
        this.fecCounter = 0;
        this.packetBuffer = [];
        this.packetSequenceNumbers = [];
        this.packetTimestamps = [];
      }
    }

    // Update sequence number and timestamp for next packet
    // Use modulo to keep within 16-bit range
    this.seqNum = (this.seqNum + 1) % 65536;
    this.timestamp = this.timestamp + this.config.timestampIncrement!;
  }

  /**
   * Sends any remaining FEC packets that might be in the buffer
   */
  private _sendRemainingFecPackets(): void {
    if (!this.config.fecEnabled || this.packetBuffer.length === 0) {
      return;
    }

    // Create and send FEC packet for any remaining packets
    const fecPacket = this._createFecPacket(
      this.packetBuffer,
      this.packetSequenceNumbers,
      this.packetTimestamps
    );

    if (fecPacket.length > 0) {
      // Encrypt the FEC packet if using SRTP
      let finalFecPacket: Buffer;
      try {
        if (this.srtpSession) {
          finalFecPacket = this.srtpSession.protect(fecPacket);
        } else {
          finalFecPacket = fecPacket;
        }
      } catch (err) {
        this.emit('error', {
          type: T140RtpErrorType.ENCRYPTION_ERROR,
          message: 'Failed to encrypt final FEC packet with SRTP - packet not sent',
          cause: err as Error,
        });
        // Don't fall back to unencrypted - abort the send operation for security
        return;
      }

      // Send the FEC packet
      this.udpSocket.send(
        finalFecPacket,
        0,
        finalFecPacket.length,
        this.remotePort,
        this.remoteAddress,
        (err) => {
          if (err) {
            this.emit('error', {
              type: T140RtpErrorType.NETWORK_ERROR,
              message: 'Failed to send final FEC packet',
              cause: err,
            });
          }
        }
      );
    }

    // Clear the buffers
    this.packetBuffer = [];
    this.packetSequenceNumbers = [];
    this.packetTimestamps = [];
    this.fecCounter = 0;
  }

  /**
   * Close the UDP socket
   */
  close(): void {
    try {
      // Send any remaining FEC packets
      this._sendRemainingFecPackets();

      // Close the socket
      this.udpSocket.close();
    } catch (err) {
      this.emit('error', {
        type: T140RtpErrorType.RESOURCE_ERROR,
        message: 'Error closing transport resources',
        cause: err as Error,
      });
    }
  }
}

/**
 * Create and initialize a WebSocket server with optional TLS support
 */
function createWebSocketServer(options: WebSocketServerOptions = {}): WebSocket.Server {
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

      // Update sequence number and timestamp
      sequenceNumber += 1;
      timestamp += 160; // Assuming 20ms per packet at 8kHz
    });

    ws.on('close', () => {
      seqpacketSocket.end();
    });
  });

  return server;
}

// Create WebSocket server (non-secure by default)
const wss = createWebSocketServer();

/**
 * Process an AI stream and send chunks through WebSocket to T.140
 * Supports both secure (wss://) and non-secure (ws://) WebSocket connections
 */
function processAIStream(
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

/**
 * Process an AI stream and send chunks directly as T.140 over RTP
 * with rate limiting to ensure compliance with specified character rate limits
 */
function processAIStreamToRtp(
  stream: TextDataStream,
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  rtpConfig: RtpConfig = {}
): T140RtpTransport {
  const transport = new T140RtpTransport(remoteAddress, remotePort, rtpConfig);
  let textBuffer = ''; // Buffer to track accumulated text for backspace handling
  const processBackspaces = rtpConfig.processBackspaces === true;

  // Rate limiting configuration - default to 30 characters per second
  const charRateLimit = rtpConfig.charRateLimit || 30; // characters per second
  const charQueue: string[] = []; // Queue to store characters waiting to be sent
  let lastSendTime = Date.now();
  let tokenBucket = charRateLimit; // Initial tokens available (full bucket)
  const tokenRefillRate = charRateLimit / 1000; // Tokens per millisecond

  // Set up the rate limiting interval
  const sendInterval = setInterval(() => {
    // Refill the token bucket
    const now = Date.now();
    const elapsedMs = now - lastSendTime;
    lastSendTime = now;

    // Add tokens based on elapsed time
    tokenBucket = Math.min(
      charRateLimit,
      tokenBucket + elapsedMs * tokenRefillRate
    );

    // If we have characters in the queue and tokens available, send them
    while (charQueue.length > 0 && tokenBucket >= 1) {
      const charsToSend = Math.min(Math.floor(tokenBucket), charQueue.length);
      const textChunk = charQueue.splice(0, charsToSend).join('');

      if (textChunk) {
        transport.sendText(textChunk);
        tokenBucket = tokenBucket - textChunk.length;
      }
    }
  }, 100); // Check every 100ms

  // Process the AI stream and add chunks to the rate-limited queue
  stream.on('data', (chunk) => {
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
    if (!text) return;

    if (processBackspaces) {
      // Process backspaces in the T.140 stream
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer
      );
      textBuffer = updatedBuffer;

      // Only queue if there's something to send
      if (processedText) {
        // Add each character to the queue for rate limiting
        for (const char of processedText) {
          charQueue.push(char);
        }
      }
    } else {
      // Add each character to the queue for rate limiting
      for (const char of text) {
        charQueue.push(char);
      }
    }
  });

  stream.on('end', () => {
    // Clear the send interval
    clearInterval(sendInterval);

    // Send any remaining characters in the queue
    if (charQueue.length > 0) {
      transport.sendText(charQueue.join(''));
    }

    // Close the transport when stream ends
    transport.close();
  });

  // Handle errors from the input stream
  stream.on('error', (err) => {
    console.error('AI Stream error:', err);
    clearInterval(sendInterval);
    transport.close();
  });

  // Forward errors from the transport to any listeners attached to the transport
  transport.on('error', (err: T140RtpError) => {
    // The error is already emitted by the transport, no need to re-emit
    // Just log for debugging if needed
    console.error(`T140RtpTransport error (${err.type}):`, err.message);
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
  let textBuffer = ''; // Buffer to track accumulated text for backspace handling
  const processBackspaces = srtpConfig.processBackspaces === true;

  // Setup SRTP
  transport.setupSrtp(srtpConfig);

  // Process the AI stream and send chunks over SRTP
  stream.on('data', (chunk) => {
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
    if (!text) return;

    if (processBackspaces) {
      // Process backspaces in the T.140 stream
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer
      );
      textBuffer = updatedBuffer;

      // Only send if there's something to send
      if (processedText) {
        transport.sendText(processedText);
      }
    } else {
      // Send text directly without backspace processing
      transport.sendText(text);
    }
  });

  stream.on('end', () => {
    // Close the transport when stream ends
    transport.close();
  });

  // Handle errors from the input stream
  stream.on('error', (err) => {
    console.error('AI Stream error:', err);
    transport.close();
  });

  // Forward errors from the transport to any listeners attached to the transport
  transport.on('error', (err: T140RtpError) => {
    // The error is already emitted by the transport, no need to re-emit
    // Just log for debugging if needed
    console.error(`T140RtpTransport error (${err.type}):`, err.message);
  });

  return transport;
}

/**
 * Process an AI stream and send chunks as RTP directly to a SEQPACKET socket
 * This is the "direct socket mode" which bypasses WebSocket but still uses RTP encapsulation
 */
function processAIStreamToDirectSocket(
  stream: TextDataStream,
  socketPath: string = SEQPACKET_SOCKET_PATH,
  rtpConfig: RtpConfig = {}
): net.Socket {
  // Create Unix SEQPACKET socket
  const seqpacketSocket = net.createConnection(socketPath);

  // Initialize RTP parameters
  let sequenceNumber = rtpConfig.initialSequenceNumber || 0;
  let timestamp = rtpConfig.initialTimestamp || 0;
  const timestampIncrement = rtpConfig.timestampIncrement || 160;
  const payloadType = rtpConfig.payloadType || DEFAULT_T140_PAYLOAD_TYPE;
  const ssrc = rtpConfig.ssrc || DEFAULT_SSRC;
  let textBuffer = ''; // Buffer to track accumulated text for backspace handling
  const processBackspaces = rtpConfig.processBackspaces === true;

  // Process the AI stream and send chunks directly to the socket
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

    // Create RTP packet for T.140
    const rtpPacket = createRtpPacket(sequenceNumber, timestamp, textToSend, {
      payloadType,
      ssrc,
    });

    // Send directly to the SEQPACKET socket without WebSocket intermediary
    seqpacketSocket.write(rtpPacket);

    // Update sequence number and timestamp for next packet
    sequenceNumber = (sequenceNumber + 1) % 65536;
    timestamp += timestampIncrement;
  });

  stream.on('end', () => {
    // Close the socket when stream ends
    seqpacketSocket.end();
  });

  stream.on('error', (err) => {
    console.error('AI Stream error:', err);
    seqpacketSocket.end();
  });

  return seqpacketSocket;
}

/**
 * Helper function to create SRTP key and salt from a passphrase
 * Uses PBKDF2 for secure key derivation
 */
function createSrtpKeysFromPassphrase(passphrase: string): {
  masterKey: Buffer;
  masterSalt: Buffer;
} {
  // Use a fixed salt for PBKDF2
  // This is a constant salt - in a production environment, consider using a per-user salt
  // that is securely stored and associated with each user
  const fixedSalt = Buffer.from('T140RtpTransportSaltValue', 'utf8');

  // Use PBKDF2 to derive key material (10000 iterations is a reasonable minimum)
  // Total 30 bytes for both key (16 bytes) and salt (14 bytes)
  const derivedKeyMaterial = crypto.pbkdf2Sync(
    passphrase,
    fixedSalt,
    10000,
    30,
    'sha256'
  );

  // Split the derived key material into master key and master salt
  const masterKey = derivedKeyMaterial.slice(0, 16);    // First 16 bytes (128 bits) for master key
  const masterSalt = derivedKeyMaterial.slice(16, 30);  // Next 14 bytes (112 bits) for master salt

  return { masterKey, masterSalt };
}

// Server status is reported by the createWebSocketServer function

/**
 * Process text to handle T.140 backspace characters
 * @param text The input text that may contain backspace characters
 * @param textBuffer Optional existing text buffer to apply backspaces to
 * @returns Object containing the processed text ready for sending and updated buffer state
 */
interface T140BackspaceResult {
  processedText: string;
  updatedBuffer: string;
}

function processT140BackspaceChars(
  text: string,
  textBuffer: string = ''
): T140BackspaceResult {
  if (!text.includes(BACKSPACE) && textBuffer === '') {
    // Fast path: if there are no backspaces and no buffer, just return the text as is
    return { processedText: text, updatedBuffer: '' };
  }

  let processedText = '';
  let updatedBuffer = textBuffer;
  let currentPos = 0;

  // Process each character in the input text
  while (currentPos < text.length) {
    const char = text[currentPos];

    if (char === BACKSPACE) {
      // Handle backspace by removing the last character from the buffer
      if (updatedBuffer.length > 0) {
        // Remove the last character from the buffer
        updatedBuffer = updatedBuffer.slice(0, -1);
        // Add backspace to the processed text to be sent
        processedText += BACKSPACE;
      }
    } else {
      // Add normal character to both buffer and processed text
      updatedBuffer += char;
      processedText += char;
    }
    currentPos += 1;
  }

  return { processedText, updatedBuffer };
}

export {
  wss,
  createRtpPacket,
  createWebSocketServer,
  WebSocketServerOptions,
  SEQPACKET_SOCKET_PATH,
  processAIStream,
  processAIStreamToRtp,
  processAIStreamToSrtp,
  processAIStreamToDirectSocket,
  createSrtpKeysFromPassphrase,
  generateSecureSSRC,
  T140RtpTransport,
  processT140BackspaceChars,
  BACKSPACE,
  T140RtpErrorType,
  // Types
  T140RtpError,
  // Export for testing purposes only
  extractTextFromChunk,
};
