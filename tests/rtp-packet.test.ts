import { createRtpPacket } from '../src/rtp/create-rtp-packet';

describe('RTP Packet Creation', () => {
  test('creates a valid RTP packet with default options', () => {
    const payload = 'test payload';
    const packet = createRtpPacket(123, 456789, payload, { ssrc: 12345 });

    expect(packet.length).toBe(12 + Buffer.from(payload).length);
    expect(packet[0] & 0xc0).toBe(0x80); // version 2
    expect(packet[1] & 0x7f).toBe(96);   // default payload type
    expect(packet[1] & 0x80).toBe(0);    // marker bit clear
    expect(packet.readUInt16BE(2)).toBe(123);
    expect(packet.readUInt32BE(4)).toBe(456789);
    expect(packet.readUInt32BE(8)).toBe(12345);
    expect(packet.slice(12).toString()).toBe(payload);
  });

  test('picks a random SSRC when none is given', () => {
    const ssrcs = new Set(
      Array.from({ length: 5 }, () => createRtpPacket(0, 0, 'x').readUInt32BE(8))
    );
    expect(ssrcs.size).toBeGreaterThan(1);
  });

  test('creates a packet with custom options', () => {
    const packet = createRtpPacket(456, 789123, 'custom payload', { payloadType: 100, ssrc: 54321 });

    expect(packet[1] & 0x7f).toBe(100);
    expect(packet.readUInt32BE(8)).toBe(54321);
  });

  test('sets the marker bit when markerBit is true', () => {
    const packet = createRtpPacket(0, 0, 'x', { ssrc: 1, markerBit: true });
    expect(packet[1] & 0x80).toBe(0x80);
  });

  test('uses payload type 99 and no marker bit by default for metadata packets', () => {
    const packet = createRtpPacket(0, 0, '{}', { ssrc: 1, metadataPacket: true });

    expect(packet[1] & 0x7f).toBe(99);
    expect(packet[1] & 0x80).toBe(0);
  });

  test('prefixes metadata packet payloads with MD:', () => {
    const packet = createRtpPacket(0, 0, '{"a":1}', { ssrc: 1, metadataPacket: true });
    expect(packet.slice(12).toString()).toBe('MD:{"a":1}');
  });

  test('handles empty payload', () => {
    expect(createRtpPacket(789, 123456, '', { ssrc: 1 }).length).toBe(12);
  });

  test('handles UTF-8 characters in payload', () => {
    const payload = 'UTF-8 test: 你好, こんにちは, 안녕하세요';
    const packet = createRtpPacket(999, 888777, payload, { ssrc: 1 });
    expect(packet.slice(12).toString()).toBe(payload);
  });
});
