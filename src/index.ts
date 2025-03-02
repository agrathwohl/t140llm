import * as dgram from "dgram";
import type { EventEmitter } from "events";
import * as net from "net";
import WebSocket from "ws";

// Import werift-rtp using require to avoid TypeScript errors
// @ts-ignore
// tslint:disable-next-line:no-var-requires
const weriftRtp = require("werift-rtp");
const { SrtpSession, SrtpPolicy, SrtpContext } = weriftRtp;

// WebSocket server address and port
const WS_SERVER_PORT = 8765;

// Unix SEQPACKET socket path
const SEQPACKET_SOCKET_PATH = "/tmp/seqpacket_socket";

// RTP/SRTP defaults
const RTP_HEADER_SIZE = 12;
const DEFAULT_RTP_PORT = 5004;
const DEFAULT_SRTP_PORT = 5006;
const DEFAULT_T140_PAYLOAD_TYPE = 96;
const DEFAULT_SSRC = 12345;
const DEFAULT_RED_PAYLOAD_TYPE = 98; // RED payload type for T.140 redundancy

// T.140 constants
const BACKSPACE = "\u0008"; // ASCII backspace character (BS)

// Interface for any streaming data source
interface TextDataStream extends EventEmitter {
  on(event: "data", listener: (data: any) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
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
  options: Partial<RtpConfig> = {},
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
    0,
  );
  rtpHeader.writeUInt8(marker * 128 + payloadType, 1);
  rtpHeader.writeUInt16BE(sequenceNumber, 2);
  rtpHeader.writeUInt32BE(timestamp, 4);
  rtpHeader.writeUInt32BE(ssrc, 8);

  const payloadBuffer = Buffer.from(payload, "utf-8");
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
  if (typeof chunk === "string") {
    return chunk;
  }
  // Handle other object with toString
  if (chunk && typeof chunk.toString === "function") {
    return chunk.toString();
  }

  return "";
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
  private packetBuffer: Buffer[] = []; // Buffer to store packets for FEC
  private packetSequenceNumbers: number[] = []; // Sequence numbers for FEC packets
  private packetTimestamps: number[] = []; // Timestamps for FEC packets
  private fecCounter: number = 0; // Counter for tracking when to send FEC packets
  private redPackets: Buffer[] = []; // Buffer to store packets for T.140 redundancy

  constructor(
    remoteAddress: string,
    remotePort: number = DEFAULT_RTP_PORT,
    config: RtpConfig = {},
  ) {
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    this.config = {
      payloadType: config.payloadType || DEFAULT_T140_PAYLOAD_TYPE,
      ssrc: config.ssrc || DEFAULT_SSRC,
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
    this.udpSocket = dgram.createSocket("udp4");
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
   * Create a Forward Error Correction (FEC) packet according to RFC 5109
   * Using XOR-based FEC for a group of RTP packets
   */
  private _createFecPacket(
    packets: Buffer[],
    sequenceNumbers: number[],
    timestamps: number[],
  ): Buffer {
    if (packets.length === 0) {
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
      0,
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
      ...packets.map((p) => p.length - RTP_HEADER_SIZE),
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
    redundantPackets: Buffer[],
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
      this.config.redundancyLevel || 2,
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
      0,
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
    const primaryPayload = Buffer.from(primaryData, "utf-8");

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
    if (this.srtpSession) {
      // Use the typed protect method
      finalPacket = this.srtpSession.protect(packet);
    } else {
      finalPacket = packet;
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
          console.error("Error sending RTP packet:", err);
        }
      },
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
          this.packetTimestamps,
        );

        // Only send if we have a valid FEC packet
        if (fecPacket.length > 0) {
          // Encrypt the FEC packet if using SRTP
          let finalFecPacket: Buffer;
          if (this.srtpSession) {
            finalFecPacket = this.srtpSession.protect(fecPacket);
          } else {
            finalFecPacket = fecPacket;
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
                console.error("Error sending FEC packet:", err);
              }
            },
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
      this.packetTimestamps,
    );

    if (fecPacket.length > 0) {
      // Encrypt the FEC packet if using SRTP
      let finalFecPacket: Buffer;
      if (this.srtpSession) {
        finalFecPacket = this.srtpSession.protect(fecPacket);
      } else {
        finalFecPacket = fecPacket;
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
            console.error("Error sending final FEC packet:", err);
          }
        },
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
    // Send any remaining FEC packets
    this._sendRemainingFecPackets();
    // Close the socket
    this.udpSocket.close();
  }
}

// Create WebSocket server
const wss = new WebSocket.Server({ port: WS_SERVER_PORT });

wss.on("connection", (ws) => {
  // Create Unix SEQPACKET socket
  const seqpacketSocket = net.createConnection(SEQPACKET_SOCKET_PATH);

  let sequenceNumber = 0;
  let timestamp = 0;

  ws.on("message", (message: string) => {
    // Create RTP packet with T.140 payload
    const rtpPacket = createRtpPacket(sequenceNumber, timestamp, message);
    // Send RTP packet through Unix SEQPACKET socket
    seqpacketSocket.write(rtpPacket);

    // Update sequence number and timestamp
    sequenceNumber += 1;
    timestamp += 160; // Assuming 20ms per packet at 8kHz
  });

  ws.on("close", () => {
    seqpacketSocket.end();
  });
});

/**
 * Process an AI stream and send chunks through WebSocket to T.140
 */
function processAIStream(
  stream: TextDataStream,
  websocketUrl: string = `ws://localhost:${WS_SERVER_PORT}`,
  options: { processBackspaces?: boolean } = {},
): void {
  const ws = new WebSocket(websocketUrl);
  let buffer = "";
  let isConnected = false;
  let textBuffer = ""; // Buffer to track accumulated text for backspace handling
  const processBackspaces = options.processBackspaces === true;

  ws.on("open", () => {
    isConnected = true;
    // Send any buffered content
    if (buffer) {
      ws.send(buffer);
      buffer = "";
    }
  });

  // Process the AI stream and send chunks through WebSocket
  stream.on("data", (chunk) => {
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
    if (!text) return;

    let textToSend = text;

    if (processBackspaces) {
      // Process backspaces in the T.140 stream
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer,
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

  stream.on("end", () => {
    // Close the WebSocket connection when stream ends
    if (isConnected) {
      ws.close();
    }
  });

  stream.on("error", (err) => {
    console.error("AI Stream error:", err);
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
  rtpConfig: RtpConfig = {},
): T140RtpTransport {
  const transport = new T140RtpTransport(remoteAddress, remotePort, rtpConfig);
  let textBuffer = ""; // Buffer to track accumulated text for backspace handling
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
      tokenBucket + elapsedMs * tokenRefillRate,
    );

    // If we have characters in the queue and tokens available, send them
    while (charQueue.length > 0 && tokenBucket >= 1) {
      const charsToSend = Math.min(Math.floor(tokenBucket), charQueue.length);
      const textChunk = charQueue.splice(0, charsToSend).join("");

      if (textChunk) {
        transport.sendText(textChunk);
        tokenBucket = tokenBucket - textChunk.length;
      }
    }
  }, 100); // Check every 100ms

  // Process the AI stream and add chunks to the rate-limited queue
  stream.on("data", (chunk) => {
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
    if (!text) return;

    if (processBackspaces) {
      // Process backspaces in the T.140 stream
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer,
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

  stream.on("end", () => {
    // Clear the send interval
    clearInterval(sendInterval);

    // Send any remaining characters in the queue
    if (charQueue.length > 0) {
      transport.sendText(charQueue.join(""));
    }

    // Close the transport when stream ends
    transport.close();
  });

  stream.on("error", (err) => {
    console.error("AI Stream error:", err);
    clearInterval(sendInterval);
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
  remotePort: number = DEFAULT_SRTP_PORT,
): T140RtpTransport {
  // Create transport
  const transport = new T140RtpTransport(remoteAddress, remotePort, srtpConfig);
  let textBuffer = ""; // Buffer to track accumulated text for backspace handling
  const processBackspaces = srtpConfig.processBackspaces === true;

  // Setup SRTP
  transport.setupSrtp(srtpConfig);

  // Process the AI stream and send chunks over SRTP
  stream.on("data", (chunk) => {
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
    if (!text) return;

    if (processBackspaces) {
      // Process backspaces in the T.140 stream
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer,
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

  stream.on("end", () => {
    // Close the transport when stream ends
    transport.close();
  });

  stream.on("error", (err) => {
    console.error("AI Stream error:", err);
    transport.close();
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
  rtpConfig: RtpConfig = {},
): net.Socket {
  // Create Unix SEQPACKET socket
  const seqpacketSocket = net.createConnection(socketPath);

  // Initialize RTP parameters
  let sequenceNumber = rtpConfig.initialSequenceNumber || 0;
  let timestamp = rtpConfig.initialTimestamp || 0;
  const timestampIncrement = rtpConfig.timestampIncrement || 160;
  const payloadType = rtpConfig.payloadType || DEFAULT_T140_PAYLOAD_TYPE;
  const ssrc = rtpConfig.ssrc || DEFAULT_SSRC;
  let textBuffer = ""; // Buffer to track accumulated text for backspace handling
  const processBackspaces = rtpConfig.processBackspaces === true;

  // Process the AI stream and send chunks directly to the socket
  stream.on("data", (chunk) => {
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
    if (!text) return;

    let textToSend = text;

    if (processBackspaces) {
      // Process backspaces in the T.140 stream
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer,
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

  stream.on("end", () => {
    // Close the socket when stream ends
    seqpacketSocket.end();
  });

  stream.on("error", (err) => {
    console.error("AI Stream error:", err);
    seqpacketSocket.end();
  });

  return seqpacketSocket;
}

/**
 * Helper function to create SRTP key and salt from a passphrase
 */
function createSrtpKeysFromPassphrase(passphrase: string): {
  masterKey: Buffer;
  masterSalt: Buffer;
} {
  // Simple implementation - in production, use a more secure key derivation
  const passphraseBuffer = Buffer.from(passphrase);
  const masterKey = Buffer.alloc(16); // 128 bits
  const masterSalt = Buffer.alloc(14); // 112 bits

  // Fill the key and salt with the passphrase (cyclic if needed)
  for (let i = 0; i < masterKey.length; i += 1) {
    masterKey[i] = passphraseBuffer[i % passphraseBuffer.length];
  }

  for (let i = 0; i < masterSalt.length; i += 1) {
    masterSalt[i] =
      passphraseBuffer[(i + masterKey.length) % passphraseBuffer.length];
  }

  return { masterKey, masterSalt };
}

console.log(`WebSocket server is running on ws://localhost:${WS_SERVER_PORT}`);

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
  textBuffer: string = "",
): T140BackspaceResult {
  if (!text.includes(BACKSPACE) && textBuffer === "") {
    // Fast path: if there are no backspaces and no buffer, just return the text as is
    return { processedText: text, updatedBuffer: "" };
  }

  let processedText = "";
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
  SEQPACKET_SOCKET_PATH,
  processAIStream,
  processAIStreamToRtp,
  processAIStreamToSrtp,
  processAIStreamToDirectSocket,
  createSrtpKeysFromPassphrase,
  T140RtpTransport,
  processT140BackspaceChars,
  BACKSPACE,
  // Export for testing purposes only
  extractTextFromChunk,
};
