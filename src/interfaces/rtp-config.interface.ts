import { LLMMetadata } from './text-data-stream.interface';
import { TransportStream } from './transport-stream.interface';

/**
 * Interface for RTP/SRTP configuration
 */
export interface RtpConfig {
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
  customTransport?: TransportStream; // Custom transport stream to use instead of UDP socket

  // LLM metadata handling options
  handleMetadata?: boolean; // Enable metadata detection and processing
  metadataCallback?: (metadata: LLMMetadata) => void; // Callback for processing metadata
  sendMetadataAsPackets?: boolean; // Send metadata as separate RTP packets
  metadataPayloadType?: number; // Optional different payload type for metadata

  // Multiplexing options
  multiplexEnabled?: boolean; // Enable multiplexing multiple streams
  streamIdentifier?: string; // Unique identifier for this stream in a multiplex
  csrcList?: number[]; // Contributing source identifiers
  useCsrcForStreamId?: boolean; // Use CSRC field for stream identification
}
