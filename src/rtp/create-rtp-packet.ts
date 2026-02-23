import { RtpConfig } from '../interfaces';
import {
  BIT_SHIFT_128,
  BIT_SHIFT_16,
  BIT_SHIFT_32,
  BIT_SHIFT_64,
  DEFAULT_T140_PAYLOAD_TYPE,
  RTP_CSRC_ENTRY_SIZE,
  RTP_HEADER_SIZE,
  RTP_OFFSET_CSRC,
  RTP_OFFSET_PAYLOAD_TYPE,
  RTP_OFFSET_SEQUENCE,
  RTP_OFFSET_SSRC,
  RTP_OFFSET_TIMESTAMP,
  RTP_OFFSET_VERSION,
  RTP_VERSION,
  MULTIPLEX_STREAM_DELIMITER,
} from '../utils/constants';
import { generateSecureSSRC } from '../utils/security';

/**
 * Function to create RTP packet with T.140 payload or metadata
 */
export function createRtpPacket(
  sequenceNumber: number,
  timestamp: number,
  payload: string,
  options: Partial<RtpConfig> & { metadataPacket?: boolean } = {}
): Buffer {
  const version = RTP_VERSION;
  const padding = 0;
  const extension = 0;

  // Set CSRC count if CSRC list is provided
  const csrcList = options.csrcList || [];
  const csrcCount = csrcList.length;

  // Set marker bit to 1 for metadata packets to distinguish them
  // This allows receivers to identify metadata packets vs regular text
  const marker = options.metadataPacket ? 1 : 0;

  // Use metadata payload type if provided and this is a metadata packet
  const payloadType =
    options.metadataPacket && options.metadataPayloadType
      ? options.metadataPayloadType
      : options.payloadType || DEFAULT_T140_PAYLOAD_TYPE;

  // Generate secure SSRC if not provided
  const ssrc = options.ssrc || generateSecureSSRC();

  // Calculate the header size with CSRC list
  const headerSize = RTP_HEADER_SIZE + (csrcCount * 4);
  const rtpHeader = Buffer.alloc(headerSize);

  // Use a different approach to avoid bitwise operations
  rtpHeader.writeUInt8(
    version * BIT_SHIFT_64 + padding * BIT_SHIFT_32 + extension * BIT_SHIFT_16 + csrcCount,
    RTP_OFFSET_VERSION
  );
  rtpHeader.writeUInt8(marker * BIT_SHIFT_128 + payloadType, RTP_OFFSET_PAYLOAD_TYPE);
  rtpHeader.writeUInt16BE(sequenceNumber, RTP_OFFSET_SEQUENCE);
  rtpHeader.writeUInt32BE(timestamp, RTP_OFFSET_TIMESTAMP);
  rtpHeader.writeUInt32BE(ssrc, RTP_OFFSET_SSRC);

  // Add CSRC identifiers if provided
  for (let i = 0; i < csrcCount; i += 1) {
    rtpHeader.writeUInt32BE(csrcList[i], RTP_OFFSET_CSRC + (i * RTP_CSRC_ENTRY_SIZE));
  }

  // Create payload buffer with optional identifiers
  let payloadBuffer;
  if (options.metadataPacket) {
    // Add metadata prefix "MD:" to identify these packets
    payloadBuffer = Buffer.from(`MD:${payload}`, 'utf-8');
  } else if (options.multiplexEnabled && options.streamIdentifier && !options.useCsrcForStreamId) {
    // Add stream identifier as a prefix for multiplexed streams when not using CSRC
    payloadBuffer = Buffer.from(`${options.streamIdentifier}${MULTIPLEX_STREAM_DELIMITER}${payload}`, 'utf-8');
  } else {
    payloadBuffer = Buffer.from(payload, 'utf-8');
  }

  return Buffer.concat([rtpHeader, payloadBuffer]);
}
