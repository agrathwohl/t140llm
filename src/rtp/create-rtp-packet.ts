import { RtpConfig } from '../interfaces';
import {
  DEFAULT_METADATA_PAYLOAD_TYPE,
  DEFAULT_T140_PAYLOAD_TYPE,
  METADATA_PACKET_PREFIX,
  MULTIPLEX_STREAM_DELIMITER,
  RTP_CSRC_ENTRY_SIZE,
  RTP_HEADER_SIZE,
  RTP_MAX_CSRC_COUNT,
  RTP_VERSION,
} from '../utils/constants';
import { generateSecureSSRC } from '../utils/security';

export interface RtpHeaderFields {
  marker: boolean;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  csrcList?: number[];
}

/**
 * Build an RTP fixed header plus optional CSRC list (RFC 3550 §5.1).
 * https://www.rfc-editor.org/rfc/rfc3550#section-5.1
 *
 *  0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * |V=2|P|X|  CC   |M|     PT      |       sequence number         |
 * |                           timestamp                           |
 * |           synchronization source (SSRC) identifier            |
 * |            contributing source (CSRC) identifiers             |
 */
export function buildRtpHeader(fields: RtpHeaderFields): Buffer {
  const csrcList = fields.csrcList ?? [];
  if (csrcList.length > RTP_MAX_CSRC_COUNT) {
    throw new Error(
      `RTP allows at most ${RTP_MAX_CSRC_COUNT} CSRC identifiers, got ${csrcList.length}`
    );
  }
  if (fields.payloadType < 0 || fields.payloadType > 127) {
    throw new Error(`RTP payload type must be 0-127, got ${fields.payloadType}`);
  }

  const header = Buffer.alloc(RTP_HEADER_SIZE + csrcList.length * RTP_CSRC_ENTRY_SIZE);
  header[0] = (RTP_VERSION << 6) | csrcList.length; // P = 0, X = 0
  header[1] = ((fields.marker ? 1 : 0) << 7) | fields.payloadType;
  header.writeUInt16BE(fields.sequenceNumber, 2);
  header.writeUInt32BE(fields.timestamp >>> 0, 4);
  header.writeUInt32BE(fields.ssrc >>> 0, 8);
  csrcList.forEach((csrc, i) => {
    header.writeUInt32BE(csrc >>> 0, RTP_HEADER_SIZE + i * RTP_CSRC_ENTRY_SIZE);
  });
  return header;
}

/**
 * Create an RTP packet carrying a T.140 text block (RFC 4103 §3).
 *
 * Library extensions, used only between T140RtpMultiplexer and
 * T140StreamDemultiplexer: a `metadataPacket` prefixes the JSON payload with
 * "MD:", and prefix-mode multiplexing prepends "<streamIdentifier>\x1E".
 * Neither is valid text/t140 for a standard receiver.
 */
export function createRtpPacket(
  sequenceNumber: number,
  timestamp: number,
  payload: string,
  options: Partial<RtpConfig> & { metadataPacket?: boolean } = {}
): Buffer {
  const isMetadata = options.metadataPacket === true;
  const header = buildRtpHeader({
    sequenceNumber,
    timestamp,
    marker: options.markerBit === true,
    payloadType: isMetadata
      ? options.metadataPayloadType ?? DEFAULT_METADATA_PAYLOAD_TYPE
      : options.payloadType ?? DEFAULT_T140_PAYLOAD_TYPE,
    ssrc: options.ssrc ?? generateSecureSSRC(),
    csrcList: options.csrcList,
  });

  let text = payload;
  if (isMetadata) {
    text = METADATA_PACKET_PREFIX + payload;
  } else if (options.multiplexEnabled && options.streamIdentifier && !options.useCsrcForStreamId) {
    text = options.streamIdentifier + MULTIPLEX_STREAM_DELIMITER + payload;
  }
  return Buffer.concat([header, Buffer.from(text, 'utf-8')]);
}
