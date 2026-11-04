import { EventEmitter } from 'events';
import {
  LLMMetadata,
  ProcessorOptions,
  RtpConfig,
  T140RtpError,
  TextDataStream,
} from '../interfaces';
import { toGraphemes } from '../utils/backspace-processing';
import {
  DEFAULT_CHAR_RATE_LIMIT,
  DEFAULT_RTP_PORT,
  IDLE_THRESHOLD_MS,
  INITIAL_CSRC_ID,
  MIN_TOKENS_PER_STREAM,
  MIN_TOKEN_BUCKET_VALUE,
  SEND_INTERVAL_MS,
  TOKEN_REFILL_RATE_DIVISOR,
} from '../utils/constants';
import { ErrorFactory } from '../utils/error-factory';
import {
  attachStreamProcessor,
  resolveStreamOptions,
} from '../utils/stream-processor';
import { T140RtpTransport } from './t140-rtp-transport';

interface StreamInfo {
  id: string;
  stream: TextDataStream;
  csrcId?: number;
  config: RtpConfig;
  charQueue: string[];
  /** Source stream ended; remove once the queue has drained. */
  ended: boolean;
  detach: () => void;
}

/**
 * Multiplexes several LLM streams into one RTP output.
 *
 * Each stream is tagged either with a CSRC identifier (`useCsrcForStreamId`)
 * or with a "<id>\x1E" prefix inside the payload. One token bucket limits the
 * total character rate across all streams. T140StreamDemultiplexer reverses
 * the tagging on the receiving side.
 *
 * Events:
 * - 'error' (T140RtpError): transport or configuration failure
 * - 'streamError' ({ streamId, error }): one stream failed; it is removed
 * - 'streamAdded' (streamId)
 * - 'streamRemoved' (streamId)
 * - 'metadata' (LLMMetadata & { streamId }): metadata from any stream
 */
export class T140RtpMultiplexer extends EventEmitter {
  private transport: T140RtpTransport;
  private streams: Map<string, StreamInfo> = new Map();
  private multiplexConfig: RtpConfig;
  private drainTimer: NodeJS.Timeout | null = null;
  private lastSendTime: number = Date.now();
  private tokenBucket: number;
  private charRateLimit: number;
  private tokenRefillRate: number;
  private nextCsrcId: number = INITIAL_CSRC_ID;
  private isIdle: boolean = true;
  private idleTimer: NodeJS.Timeout | null = null;

  /**
   * @param remoteAddress Remote address to send multiplexed packets to
   * @param remotePort Remote port to send multiplexed packets to
   * @param multiplexConfig Configuration shared by all streams
   */
  constructor(
    remoteAddress: string,
    remotePort: number = DEFAULT_RTP_PORT,
    multiplexConfig: RtpConfig = {}
  ) {
    super();

    this.multiplexConfig = { ...multiplexConfig, multiplexEnabled: true };
    this.transport = new T140RtpTransport(remoteAddress, remotePort, this.multiplexConfig);
    this.transport.on('error', (err: T140RtpError) => this.emit('error', err));

    this.charRateLimit = this.multiplexConfig.charRateLimit || DEFAULT_CHAR_RATE_LIMIT;
    this.tokenBucket = this.charRateLimit;
    this.tokenRefillRate = this.charRateLimit / TOKEN_REFILL_RATE_DIVISOR;
  }

  /** The underlying transport. Exposed for tests. */
  public getTransport(): T140RtpTransport {
    return this.transport;
  }

  /**
   * Add a stream to the multiplexer.
   *
   * @param id Unique identifier for this stream
   * @param stream The stream to add
   * @param streamConfig Optional configuration specific to this stream
   * @param processorOptions Optional processor options for this stream
   * @returns True if the stream was added
   */
  addStream(
    id: string,
    stream: TextDataStream,
    streamConfig: RtpConfig = {},
    processorOptions: ProcessorOptions = {}
  ): boolean {
    if (this.streams.has(id)) {
      this.emit(
        'error',
        ErrorFactory.INVALID_CONFIG(`Stream with ID ${id} already exists in multiplexer`)
      );
      return false;
    }

    const config: RtpConfig = {
      ...this.multiplexConfig,
      ...streamConfig,
      streamIdentifier: id,
      multiplexEnabled: true,
    };
    // All streams share the transport's SSRC and sequence space (RFC 3550 §3).
    delete config.ssrc;

    let csrcId: number | undefined;
    if (this.multiplexConfig.useCsrcForStreamId) {
      csrcId = this.nextCsrcId;
      this.nextCsrcId += 1;
      config.csrcList = [csrcId];
    }

    const streamInfo: StreamInfo = {
      id,
      stream,
      csrcId,
      config,
      charQueue: [],
      ended: false,
      detach: () => undefined,
    };
    this.streams.set(id, streamInfo);
    streamInfo.detach = this._attach(streamInfo, processorOptions);
    this.emit('streamAdded', id);
    return true;
  }

  /**
   * Remove a stream now. Sends any characters still queued for it.
   *
   * @param id ID of the stream to remove
   * @returns True if the stream was found and removed
   */
  removeStream(id: string): boolean {
    const streamInfo = this.streams.get(id);
    if (!streamInfo) {
      return false;
    }

    streamInfo.detach();
    if (streamInfo.charQueue.length > 0) {
      this._sendText(streamInfo.charQueue.splice(0).join(''), streamInfo);
    }

    this.streams.delete(id);
    this.emit('streamRemoved', id);
    return true;
  }

  /**
   * Close the multiplexer: flush every queue, detach every stream, close the transport.
   */
  close(): void {
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null; }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }

    for (const streamInfo of this.streams.values()) {
      streamInfo.detach();
      if (streamInfo.charQueue.length > 0) {
        this._sendText(streamInfo.charQueue.splice(0).join(''), streamInfo);
      }
    }
    this.streams.clear();
    this.transport.close();
  }

  getStreamCount(): number {
    return this.streams.size;
  }

  getStreamIds(): string[] {
    return Array.from(this.streams.keys());
  }

  /**
   * Run the stream through the shared pipeline (text extraction, metadata,
   * backspaces). Text lands in the per-stream character queue; metadata is
   * tagged with the stream id and re-emitted here.
   */
  private _attach(streamInfo: StreamInfo, processorOptions: ProcessorOptions): () => void {
    const { id, stream, config } = streamInfo;
    const options = resolveStreamOptions(processorOptions, {
      processBackspaces: config.processBackspaces,
      handleMetadata: config.handleMetadata,
      metadataCallback: config.metadataCallback,
      onError: config.onError,
    });

    const userMetadataCallback = options.metadataCallback;
    options.metadataCallback = (metadata: LLMMetadata) => {
      const tagged = { ...metadata, streamId: id };
      this.emit('metadata', tagged);
      userMetadataCallback?.(tagged);
    };

    const userOnError = options.onError;
    options.onError = (error: Error) => {
      this.emit('streamError', { error, streamId: id });
      userOnError?.(error);
    };

    return attachStreamProcessor(stream, options, {
      sendText: (text, graphemes) => {
        streamInfo.charQueue.push(...(graphemes ?? toGraphemes(text)));
        this._scheduleDrain();
      },
      close: () => {
        // Let the queue drain at the character rate limit, then remove.
        streamInfo.ended = true;
        this._scheduleDrain();
      },
    });
  }

  private _scheduleDrain(): void {
    if (!this.drainTimer) {
      this._flushQueues();
    }
  }

  /**
   * Share the token bucket across streams and send what each one may.
   * The first packet after an idle period carries the M-bit (RFC 4103 §3).
   */
  private _flushQueues(): void {
    this.drainTimer = null;

    const now = Date.now();
    const elapsedMs = now - this.lastSendTime;
    this.lastSendTime = now;

    this.tokenBucket = Math.min(
      this.charRateLimit,
      this.tokenBucket + elapsedMs * this.tokenRefillRate
    );

    let firstSendInBurst = this.isIdle;
    if (this.streams.size > 0 && this.tokenBucket >= MIN_TOKEN_BUCKET_VALUE) {
      const tokensPerStream = Math.max(
        MIN_TOKENS_PER_STREAM,
        Math.floor(this.tokenBucket / this.streams.size)
      );

      for (const streamInfo of this.streams.values()) {
        if (streamInfo.charQueue.length === 0) continue;

        const charsToSend = Math.min(tokensPerStream, streamInfo.charQueue.length);
        const textChunk = streamInfo.charQueue.splice(0, charsToSend).join('');
        if (!textChunk) continue;

        this._sendText(textChunk, streamInfo, firstSendInBurst);
        this.tokenBucket -= textChunk.length;
        if (firstSendInBurst) {
          firstSendInBurst = false;
          this.isIdle = false;
          if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
        }
      }
    }

    for (const streamInfo of Array.from(this.streams.values())) {
      if (streamInfo.ended && streamInfo.charQueue.length === 0) {
        this.removeStream(streamInfo.id);
      }
    }

    const hasQueuedChars = Array.from(this.streams.values())
      .some((s) => s.charQueue.length > 0);
    if (hasQueuedChars && !this.drainTimer) {
      this.drainTimer = setTimeout(() => this._flushQueues(), SEND_INTERVAL_MS);
    } else if (!hasQueuedChars) {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.isIdle = true;
        this.idleTimer = null;
      }, IDLE_THRESHOLD_MS);
    }
  }

  private _sendText(text: string, streamInfo: StreamInfo, markerBit?: boolean): void {
    this.transport.sendText(text, {
      ...streamInfo.config,
      markerBit,
      streamIdentifier: streamInfo.id,
      csrcList: streamInfo.csrcId !== undefined ? [streamInfo.csrcId] : undefined,
    });
  }
}
