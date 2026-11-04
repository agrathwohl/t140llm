import { EventEmitter } from 'events';
import { LLMMetadata } from '../interfaces';
import {
  DEFAULT_RED_PAYLOAD_TYPE,
  METADATA_PACKET_PREFIX,
  MULTIPLEX_STREAM_DELIMITER,
  RTP_HEADER_SIZE,
} from './constants';
import { extractT140Text } from './parse-red-packet';

/**
 * Interface for demultiplexed stream data
 */
export interface DemultiplexedData {
  streamId: string;
  text?: string;
  metadata?: LLMMetadata;
}

/**
 * Interface for a demultiplexed stream
 */
export interface DemultiplexedStream extends EventEmitter {
  streamId: string;

  on(event: 'data', listener: (text: string) => void): this;
  on(event: 'metadata', listener: (metadata: LLMMetadata) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

/**
 * Class representing a demultiplexed stream extracted from multiplexed data
 */
export class DemultiplexedStreamImpl extends EventEmitter implements DemultiplexedStream {
  constructor(public streamId: string) {
    super();
  }

  pushText(text: string): void {
    this.emit('data', text);
  }

  pushMetadata(metadata: LLMMetadata): void {
    this.emit('metadata', metadata);
  }

  end(): void {
    this.emit('end');
  }

  error(error: Error): void {
    this.emit('error', error);
  }
}

/**
 * Class for demultiplexing RTP streams that were multiplexed with T140RtpMultiplexer
 *
 * Events:
 * - 'stream': Emitted when a new stream is detected (provides ID and stream instance)
 * - 'data': Emitted for all demultiplexed data (provides streamId, text, metadata)
 * - 'error': Emitted when an error occurs
 */
export class T140StreamDemultiplexer extends EventEmitter {
  private streams: Map<string, DemultiplexedStreamImpl> = new Map();
  private readonly redPayloadType: number;

  /**
   * @param options.redPayloadType Payload type the sender uses for text/red.
   *   Packets with this type are parsed per RFC 2198 and only the primary
   *   T140block is delivered. Default 98.
   */
  constructor(options: { redPayloadType?: number } = {}) {
    super();
    this.redPayloadType = options.redPayloadType ?? DEFAULT_RED_PAYLOAD_TYPE;
  }

  /**
   * Process RTP packet data and extract stream information
   *
   * @param data Buffer containing RTP packet data
   * @param useCSRC Whether to use CSRC fields for stream identification
   */
  processPacket(data: Buffer, useCSRC: boolean = false): void {
    try {
      // Reads plain text/t140 and text/red alike, skipping the CSRC list, any
      // header extension, and trailing padding (RFC 3550 §5.1, RFC 2198 §3).
      const payloadStr = extractT140Text(data, this.redPayloadType);
      const csrcCount = data[0] & 0x0f;

      if (useCSRC) {
        if (csrcCount === 0) {
          this.emit('error', new Error('No CSRC identifiers found in packet'));
          return;
        }
        this._processText(`csrc:${data.readUInt32BE(RTP_HEADER_SIZE)}`, payloadStr);
        return;
      }

      if (payloadStr.startsWith(METADATA_PACKET_PREFIX)) {
        const metadataContent = payloadStr.substring(METADATA_PACKET_PREFIX.length);
        try {
          const metadata = JSON.parse(metadataContent);
          if (metadata.streamId) {
            this._processMetadata(metadata.streamId, metadata);
          } else {
            this.emit('error', new Error('Metadata packet missing streamId'));
          }
        } catch (err) {
          this.emit('error', new Error(`Failed to parse metadata: ${err}`));
        }

        return;
      }
      const delimiterIndex = payloadStr.indexOf(MULTIPLEX_STREAM_DELIMITER);
      if (delimiterIndex > 0) {
        this._processText(
          payloadStr.substring(0, delimiterIndex),
          payloadStr.substring(delimiterIndex + 1)
        );
      } else {
        this._processText('default', payloadStr);
      }
    } catch (err) {
      this.emit('error', new Error(`Error processing packet: ${err}`));
    }
  }
  /**
   * Get a stream by ID, creating it if it doesn't exist
   */
  private _getOrCreateStream(streamId: string): DemultiplexedStreamImpl {
    let stream = this.streams.get(streamId);

    if (!stream) {
      stream = new DemultiplexedStreamImpl(streamId);
      this.streams.set(streamId, stream);
      this.emit('stream', streamId, stream);
    }

    return stream;
  }

  /**
   * Process text data for a specific stream
   */
  private _processText(streamId: string, text: string): void {
    // An empty T140block signals the start of an idle period (RFC 4103 §5.2).
    // It has nothing to display, so create the stream but emit no data.
    if (text === '') {
      this._getOrCreateStream(streamId);
      return;
    }

    const stream = this._getOrCreateStream(streamId);

    stream.pushText(text);

    this.emit('data', {
      streamId,
      text,
    });
  }

  /**
   * Process metadata for a specific stream
   */
  private _processMetadata(streamId: string, metadata: LLMMetadata): void {
    const stream = this._getOrCreateStream(streamId);

    stream.pushMetadata(metadata);

    this.emit('data', {
      streamId,
      metadata,
    });
  }

  /**
   * Get a stream by ID
   */
  getStream(streamId: string): DemultiplexedStream | undefined {
    return this.streams.get(streamId);
  }

  /**
   * Get all stream IDs
   */
  getStreamIds(): string[] {
    return Array.from(this.streams.keys());
  }
}
