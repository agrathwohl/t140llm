import { EventEmitter } from 'events';
import {
  ProcessorOptions,
  RtpConfig,
  T140RtpError,
  T140RtpErrorType,
  TextDataStream,
} from '../interfaces';
import { toGraphemes } from '../utils/backspace-processing';
import {
  DEFAULT_CHAR_RATE_LIMIT,
  DEFAULT_RTP_PORT,
  INITIAL_CSRC_ID,
  MIN_TOKENS_PER_STREAM,
  MIN_TOKEN_BUCKET_VALUE,
  SEND_INTERVAL_MS,
  TOKEN_REFILL_RATE_DIVISOR,
} from '../utils/constants';
import { ErrorFactory } from '../utils/error-factory';
import { extractTextFromChunk } from '../utils/extract-text';
import { T140RtpTransport } from './t140-rtp-transport';

interface StreamInfo {
  id: string;
  stream: TextDataStream;
  ssrc: number;
  csrcId?: number;
  config: RtpConfig;
  options: ProcessorOptions;
  buffer: string;
  charQueue: string[];
}

/**
 * A class to multiplex multiple LLM streams into a single RTP output
 *
 * Events:
 * - 'error': Emitted when an error occurs with the multiplexer
 * - 'streamError': Emitted when an error occurs with a specific stream (includes stream ID)
 * - 'streamAdded': Emitted when a new stream is added
 * - 'streamRemoved': Emitted when a stream is removed
 * - 'metadata': Emitted when metadata is received from any stream (includes stream ID)
 */
export class T140RtpMultiplexer extends EventEmitter {
  private transport: T140RtpTransport;
  private streams: Map<string, StreamInfo> = new Map();
  private multiplexConfig: RtpConfig;
  private sendInterval: NodeJS.Timeout;
  private lastSendTime: number = Date.now();
  private tokenBucket: number;
  private nextCsrcId: number = INITIAL_CSRC_ID;

  // Expose for testing purposes
  public getTransport(): T140RtpTransport {
    return this.transport;
  }

  /**
   * Create a new multiplexer for T140 RTP streams
   *
   * @param remoteAddress Remote address to send multiplexed packets to
   * @param remotePort Remote port to send multiplexed packets to
   * @param multiplexConfig Configuration for the multiplexer
   */
  constructor(
    remoteAddress: string,
    remotePort: number = DEFAULT_RTP_PORT,
    multiplexConfig: RtpConfig = {}
  ) {
    super();

    // Ensure multiplexing is enabled in config
    this.multiplexConfig = {
      ...multiplexConfig,
      multiplexEnabled: true,
    };

    // Create the shared transport
    this.transport = new T140RtpTransport(
      remoteAddress,
      remotePort,
      this.multiplexConfig
    );

    // Forward transport errors
    this.transport.on('error', (err: T140RtpError) => {
      this.emit('error', err);
    });

    // Setup rate limiting for all streams combined
    const charRateLimit = this.multiplexConfig.charRateLimit || DEFAULT_CHAR_RATE_LIMIT;
    this.tokenBucket = charRateLimit;
    const tokenRefillRate = charRateLimit / TOKEN_REFILL_RATE_DIVISOR;

    // Start the shared send interval
    this.sendInterval = setInterval(() => {
      const now = Date.now();
      const elapsedMs = now - this.lastSendTime;
      this.lastSendTime = now;

      // Refill token bucket based on elapsed time
      this.tokenBucket = Math.min(
        charRateLimit,
        this.tokenBucket + elapsedMs * tokenRefillRate
      );

      // Process all streams in a round-robin fashion
      if (this.streams.size > 0 && this.tokenBucket >= MIN_TOKEN_BUCKET_VALUE) {
        // Get all stream IDs
        const streamIds = Array.from(this.streams.keys());

        // Calculate tokens per stream (minimum 1)
        const tokensPerStream = Math.max(
          MIN_TOKENS_PER_STREAM,
          Math.floor(this.tokenBucket / streamIds.length)
        );

        // Process characters from each stream
        for (const streamId of streamIds) {
          const streamInfo = this.streams.get(streamId);
          if (!streamInfo) continue;

          if (streamInfo.charQueue.length > 0) {
            const charsToSend = Math.min(tokensPerStream, streamInfo.charQueue.length);
            const textChunk = streamInfo.charQueue.splice(0, charsToSend).join('');

            if (textChunk) {
              // Send with stream identifier
              this._sendText(textChunk, streamInfo);
              this.tokenBucket -= textChunk.length;
            }
          }
        }
      }
    }, SEND_INTERVAL_MS);
  }

  /**
   * Add a new stream to the multiplexer
   *
   * @param id Unique identifier for this stream
   * @param stream The stream to add
   * @param streamConfig Optional configuration specific to this stream
   * @param processorOptions Optional processor options for this stream
   * @returns True if the stream was added successfully
   */
  addStream(
    id: string,
    stream: TextDataStream,
    streamConfig: RtpConfig = {},
    processorOptions: ProcessorOptions = {}
  ): boolean {
    // Check if stream with this ID already exists
    if (this.streams.has(id)) {
      this.emit('error', ErrorFactory.INVALID_CONFIG(
        `Stream with ID ${id} already exists in multiplexer`
      ));
      return false;
    }

    // Assign a CSRC ID for this stream if using CSRC for identification
    let csrcId;
    if (this.multiplexConfig.useCsrcForStreamId) {
      csrcId = this.nextCsrcId;
      this.nextCsrcId += 1;
    }

    // Combine configurations with stream-specific overrides
    const config: RtpConfig = {
      ...this.multiplexConfig,
      ...streamConfig,
      streamIdentifier: id,
      multiplexEnabled: true,
    };

    // If using CSRC for stream ID, add to CSRC list
    if (csrcId !== undefined) {
      config.csrcList = [csrcId];
    }

    // Create stream info
    const processOptions = {
      ...processorOptions,
      handleMetadata: processorOptions.handleMetadata !== false &&
        config.handleMetadata !== false,
      processBackspaces: processorOptions.processBackspaces || config.processBackspaces,
    };

    const streamInfo: StreamInfo = {
      id,
      stream,
      csrcId,
      config,
      buffer: '',
      charQueue: [],
      options: processOptions,
      ssrc: config.ssrc || this.multiplexConfig.ssrc || 0,
    };

    // Set up event handlers for this stream
    this._setupStreamHandlers(streamInfo);

    // Add to streams map
    this.streams.set(id, streamInfo);

    // Emit event
    this.emit('streamAdded', id);

    return true;
  }

  /**
   * Remove a stream from the multiplexer
   *
   * @param id ID of the stream to remove
   * @returns True if the stream was found and removed
   */
  removeStream(id: string): boolean {
    const streamInfo = this.streams.get(id);
    if (!streamInfo) {
      return false;
    }

    // Remove all listeners from the stream
    streamInfo.stream.removeAllListeners();

    // Send any remaining characters
    if (streamInfo.charQueue.length > 0) {
      const textChunk = streamInfo.charQueue.join('');
      this._sendText(textChunk, streamInfo);
    }

    // Remove from streams map
    this.streams.delete(id);

    // Emit event
    this.emit('streamRemoved', id);

    return true;
  }

  /**
   * Set up event handlers for a stream
   */
  private _setupStreamHandlers(streamInfo: StreamInfo): void {
    const { stream, options, id } = streamInfo;

    stream.on('data', (chunk) => {
      const { text, metadata } = extractTextFromChunk(chunk);

      // Handle metadata if enabled
      if (metadata && options.handleMetadata) {
        // Add stream ID to metadata
        const metadataWithStreamId = {
          ...metadata,
          streamId: id,
        };

        // Emit metadata event
        this.emit('metadata', metadataWithStreamId);
        stream.emit('metadata', metadataWithStreamId);

        // Call metadata callback if provided
        const metadataCallback = options.metadataCallback || streamInfo.config.metadataCallback;
        if (metadataCallback) {
          metadataCallback(metadataWithStreamId);
        }
      }

      // Handle text content
      if (text) {
        // Add to character queue using grapheme clusters for proper Unicode handling
        streamInfo.charQueue.push(...toGraphemes(text));
      }
    });

    stream.on('end', () => {
      this.removeStream(id);
    });

    stream.on('error', (err) => {
      // Emit stream-specific error
      this.emit('streamError', {
        streamId: id,
        error: err,
      });

      // Remove the stream on error
      this.removeStream(id);
    });
  }

  /**
   * Send text with stream identification
   */
  private _sendText(text: string, streamInfo: StreamInfo): void {
    // Send using the shared transport with stream identification
    this.transport.sendText(text, {
      ...streamInfo.config,
      streamIdentifier: streamInfo.id,
      csrcList: streamInfo.csrcId !== undefined ? [streamInfo.csrcId] : undefined,
    });
  }

  /**
   * Close the multiplexer and all streams
   */
  close(): void {
    // Clear the send interval
    clearInterval(this.sendInterval);

    // Send any remaining characters from all streams
    for (const [id, streamInfo] of this.streams.entries()) {
      if (streamInfo.charQueue.length > 0) {
        const textChunk = streamInfo.charQueue.join('');
        this._sendText(textChunk, streamInfo);
      }

      // Remove all listeners
      streamInfo.stream.removeAllListeners();
    }

    // Clear streams map
    this.streams.clear();

    // Close the transport
    this.transport.close();
  }

  /**
   * Get the number of active streams
   */
  getStreamCount(): number {
    return this.streams.size;
  }

  /**
   * Get IDs of all active streams
   */
  getStreamIds(): string[] {
    return Array.from(this.streams.keys());
  }
}
