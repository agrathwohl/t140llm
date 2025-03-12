import { RtpConfig } from '../interfaces';
import { DEFAULT_T140_PAYLOAD_TYPE, RTP_HEADER_SIZE } from '../utils/constants';
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
  const version = 2;
  const padding = 0;
  const extension = 0;
  const csrcCount = 0;

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

  // For metadata packets, add a small prefix to identify them on the receiving end
  // even if marker bits are ignored by intermediaries
  let payloadBuffer;
  if (options.metadataPacket) {
    // Add metadata prefix "MD:" to identify these packets
    payloadBuffer = Buffer.from(`MD:${payload}`, 'utf-8');
  } else {
    payloadBuffer = Buffer.from(payload, 'utf-8');
  }

  return Buffer.concat([rtpHeader, payloadBuffer]);
}
