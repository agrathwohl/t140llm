import {
  DEFAULT_RED_PAYLOAD_TYPE,
  RTP_CSRC_ENTRY_SIZE,
  RTP_HEADER_SIZE,
} from './constants';

/** One T140block recovered from a text/red packet. */
export interface RedBlock {
  /** Payload type the block was originally sent with. */
  payloadType: number;
  /** Milliseconds before the packet timestamp at which this block was sent. */
  timestampOffset: number;
  /** The block text. Empty for an empty T140block. */
  text: string;
}

/** A parsed text/red packet (RFC 2198 §3 as profiled by RFC 4103 §4). */
export interface ParsedRedPacket {
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  marker: boolean;
  /** Redundant blocks, oldest first. */
  redundant: RedBlock[];
  /** The new text in this packet. */
  primary: string;
}

/**
 * Parse a text/red packet into its redundant blocks and primary text.
 * https://www.rfc-editor.org/rfc/rfc2198#section-3
 *
 * Each redundant block header is 4 bytes: F bit, 7-bit payload type, 14-bit
 * timestamp offset, 10-bit block length. The primary header is 1 byte with
 * F clear. Blocks follow in the same order as their headers, oldest first.
 *
 * @param packet A full RTP packet whose payload type is text/red
 * @returns The header fields, the redundant blocks, and the primary text
 * @throws Error when the packet is truncated or the headers do not fit
 */
export function parseT140RedPacket(packet: Buffer): ParsedRedPacket {
  if (packet.length < RTP_HEADER_SIZE) {
    throw new Error('Packet is shorter than an RTP header');
  }

  const csrcCount = packet[0] & 0x0f;
  let offset = RTP_HEADER_SIZE + csrcCount * RTP_CSRC_ENTRY_SIZE;
  if (packet[0] & 0x10) {
    // Header extension (RFC 3550 §5.3.1): 4-byte preamble plus 32-bit words.
    offset += 4 + packet.readUInt16BE(offset + 2) * 4;
  }

  const headers: { payloadType: number; timestampOffset: number; length: number }[] = [];
  for (;;) {
    if (offset >= packet.length) {
      throw new Error('Truncated RED headers');
    }
    const isRedundant = (packet[offset] & 0x80) !== 0;
    if (!isRedundant) {
      offset += 1; // primary block header, no offset or length
      break;
    }
    if (offset + 4 > packet.length) {
      throw new Error('Truncated RED block header');
    }
    const word = packet.readUInt32BE(offset);
    headers.push({
      payloadType: (word >>> 24) & 0x7f,
      timestampOffset: (word >>> 10) & 0x3fff,
      length: word & 0x3ff,
    });
    offset += 4;
  }

  const redundant: RedBlock[] = [];
  for (const header of headers) {
    const end = offset + header.length;
    if (end > packet.length) {
      throw new Error('RED block length runs past the end of the packet');
    }
    redundant.push({
      payloadType: header.payloadType,
      timestampOffset: header.timestampOffset,
      text: packet.subarray(offset, end).toString('utf-8'),
    });
    offset = end;
  }

  return {
    redundant,
    payloadType: packet[1] & 0x7f,
    marker: (packet[1] & 0x80) !== 0,
    sequenceNumber: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    ssrc: packet.readUInt32BE(8),
    primary: packet.subarray(offset).toString('utf-8'),
  };
}

/**
 * Extract the text a T.140 receiver should display from one RTP packet.
 *
 * Returns the primary T140block for a text/red packet, or the whole payload
 * for a plain text/t140 packet. Redundant blocks are for recovering text from
 * packets that never arrived, so they are skipped here.
 *
 * @param packet A full RTP packet
 * @param redPayloadType The payload type used for text/red, default 98
 */
export function extractT140Text(
  packet: Buffer,
  redPayloadType: number = DEFAULT_RED_PAYLOAD_TYPE
): string {
  if ((packet[1] & 0x7f) === redPayloadType) {
    return parseT140RedPacket(packet).primary;
  }
  const csrcCount = packet[0] & 0x0f;
  let offset = RTP_HEADER_SIZE + csrcCount * RTP_CSRC_ENTRY_SIZE;
  if (packet[0] & 0x10) {
    offset += 4 + packet.readUInt16BE(offset + 2) * 4;
  }
  const padding = packet[0] & 0x20 ? packet[packet.length - 1] : 0;
  return packet.subarray(offset, packet.length - padding).toString('utf-8');
}
