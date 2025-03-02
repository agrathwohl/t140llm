import { createRtpPacket } from '../src';

describe('RTP Packet Creation', () => {
  test('creates a valid RTP packet with default options', () => {
    const sequenceNumber = 123;
    const timestamp = 456789;
    const payload = 'test payload';
    
    const packet = createRtpPacket(sequenceNumber, timestamp, payload);
    
    // Packet should be header (12 bytes) + payload length
    expect(packet.length).toBe(12 + Buffer.from(payload).length);
    
    // Check header values
    expect(packet[0] & 0xC0).toBe(0x80); // Version should be 2 (first 2 bits)
    expect(packet[1] & 0x7F).toBe(96);   // Payload type should be 96 (default)
    
    // Check sequence number (bytes 2-3)
    expect(packet.readUInt16BE(2)).toBe(sequenceNumber);
    
    // Check timestamp (bytes 4-7)
    expect(packet.readUInt32BE(4)).toBe(timestamp);
    
    // Check SSRC (bytes 8-11)
    expect(packet.readUInt32BE(8)).toBe(12345); // Default SSRC
    
    // Check payload
    const payloadBuffer = packet.slice(12);
    expect(payloadBuffer.toString()).toBe(payload);
  });
  
  test('creates a packet with custom options', () => {
    const sequenceNumber = 456;
    const timestamp = 789123;
    const payload = 'custom payload';
    const options = {
      payloadType: 99,
      ssrc: 54321
    };
    
    const packet = createRtpPacket(sequenceNumber, timestamp, payload, options);
    
    // Check custom payload type
    expect(packet[1] & 0x7F).toBe(options.payloadType);
    
    // Check custom SSRC
    expect(packet.readUInt32BE(8)).toBe(options.ssrc);
  });
  
  test('handles empty payload', () => {
    const sequenceNumber = 789;
    const timestamp = 123456;
    const payload = '';
    
    const packet = createRtpPacket(sequenceNumber, timestamp, payload);
    
    // Packet should be header only (12 bytes)
    expect(packet.length).toBe(12);
  });
  
  test('handles UTF-8 characters in payload', () => {
    const sequenceNumber = 999;
    const timestamp = 888777;
    const payload = 'UTF-8 test: 你好, こんにちは, 안녕하세요';
    
    const packet = createRtpPacket(sequenceNumber, timestamp, payload);
    
    // Extract and check payload
    const payloadBuffer = packet.slice(12);
    expect(payloadBuffer.toString()).toBe(payload);
  });
});