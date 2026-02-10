import { EventEmitter } from 'events';
import { LLMMetadata } from '../interfaces';
import {
  RTP_CSRC_ENTRY_SIZE,
  RTP_HEADER_SIZE,
  RTP_OFFSET_CSRC,
} from './constants';

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

  // Events
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

  // Methods to push data into the stream
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

  constructor() {
    super();
  }

  /**
   * Process RTP packet data and extract stream information
   *
   * @param data Buffer containing RTP packet data
   * @param useCSRC Whether to use CSRC fields for stream identification
   */
  processPacket(data: Buffer, useCSRC: boolean = false): void {
    try {
      // Skip RTP header processing for this example
      // In a real implementation, you would parse the RTP header properly

      let streamId: string | undefined;

      // Extract CSRC fields if using them for stream identification
      if (useCSRC) {
        // Read the first byte of the RTP header
        const firstByte = data[0];
        // Extract CSRC count (CC field, bottom 4 bits per RFC 3550)
        const csrcCount = firstByte & 0x0F;

        if (csrcCount > 0) {
          // Read the first CSRC as stream identifier
          // CSRC identifiers start at byte 12 in the RTP header per RFC 3550
          const csrcId = data.readUInt32BE(RTP_OFFSET_CSRC);
          streamId = `csrc:${csrcId}`;
        } else {
          // No CSRC, can't identify stream
          this.emit('error', new Error('No CSRC identifiers found in packet'));
          return;
        }
      } else {
        // Using prefix-based identification
        // Calculate dynamic RTP header size per RFC 3550
        const firstByte = data[0];
        const csrcCount = firstByte & 0x0F;
        const headerSize = RTP_HEADER_SIZE + (csrcCount * RTP_CSRC_ENTRY_SIZE);
        const payloadWithPrefix = data.slice(headerSize);
        const payloadStr = payloadWithPrefix.toString('utf-8');

        // Check for metadata marker
        if (payloadStr.startsWith('MD:')) {
          // This is a metadata packet
          const metadataContent = payloadStr.substring(3);

          try {
            // Attempt to parse as JSON
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

        // Check for stream identifier prefix (format: "streamId:payload")
        const colonIndex = payloadStr.indexOf(':');
        if (colonIndex > 0) {
          streamId = payloadStr.substring(0, colonIndex);
          const textContent = payloadStr.substring(colonIndex + 1);

          // Get or create the stream
          this._processText(streamId, textContent);
        } else {
          // No identifier found, treat as default stream
          streamId = 'default';
          this._processText(streamId, payloadStr);
        }
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
    const stream = this._getOrCreateStream(streamId);

    // Push the text to the stream
    stream.pushText(text);

    // Emit demultiplexed data event
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

    // Push the metadata to the stream
    stream.pushMetadata(metadata);

    // Emit demultiplexed data event
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
