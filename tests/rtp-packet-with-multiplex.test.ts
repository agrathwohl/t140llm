import { createRtpPacket } from '../src/rtp/create-rtp-packet';
import { RtpConfig } from '../src/interfaces';
import { DEFAULT_T140_PAYLOAD_TYPE } from '../src/utils/constants';

describe('createRtpPacket with multiplexing support', () => {
  const testSequence = 1234;
  const testTimestamp = 5678;
  const testText = 'hello world';
  
  it('should create a basic RTP packet without multiplexing', () => {
    const packet = createRtpPacket(testSequence, testTimestamp, testText);
    
    // Verify header fields
    expect(packet.length).toBeGreaterThan(12); // 12 is min RTP header size
    expect(packet[0] & 0xC0).toBe(0x80); // Version 2
    expect(packet[1] & 0x7F).toBe(DEFAULT_T140_PAYLOAD_TYPE); // Default payload type
    expect(packet.readUInt16BE(2)).toBe(testSequence); // Sequence number
    expect(packet.readUInt32BE(4)).toBe(testTimestamp); // Timestamp
    
    // Verify payload
    const payload = packet.slice(12).toString('utf-8');
    expect(payload).toBe(testText);
  });
  
  it('should create an RTP packet with CSRC field for stream identification', () => {
    const options: Partial<RtpConfig> = {
      multiplexEnabled: true,
      useCsrcForStreamId: true,
      streamIdentifier: 'test-stream',
      csrcList: [42], // CSRC identifier for this stream
    };
    
    const packet = createRtpPacket(testSequence, testTimestamp, testText, options);
    
    // Verify header fields with CSRC
    expect(packet.length).toBeGreaterThan(16); // 12 + 4 for CSRC
    expect(packet[0] & 0x0F).toBe(1); // CSRC count of 1
    expect(packet.readUInt32BE(12)).toBe(42); // CSRC value at index 12
    
    // Verify payload starts after CSRC
    const payload = packet.slice(16).toString('utf-8');
    expect(payload).toBe(testText); // No prefix with CSRC
  });
  
  it('should create an RTP packet with stream ID prefix when not using CSRC', () => {
    const options: Partial<RtpConfig> = {
      multiplexEnabled: true,
      useCsrcForStreamId: false,
      streamIdentifier: 'test-stream',
    };
    
    const packet = createRtpPacket(testSequence, testTimestamp, testText, options);
    
    // Verify header fields without CSRC
    expect(packet[0] & 0x0F).toBe(0); // CSRC count of 0
    
    // Verify payload contains stream identifier prefix
    const payload = packet.slice(12).toString('utf-8');
    expect(payload).toBe('test-stream\x1Ehello world');
  });
  
  it('should create a metadata packet with marker bit set', () => {
    const options: Partial<RtpConfig> & { metadataPacket: boolean } = {
      metadataPacket: true,
      metadataPayloadType: 100, // Custom payload type for metadata
    };
    
    const packet = createRtpPacket(testSequence, testTimestamp, testText, options);
    
    // Verify metadata marker bit is set
    expect(packet[1] & 0x80).toBe(0x80); // Marker bit
    expect(packet[1] & 0x7F).toBe(100); // Metadata payload type
    
    // Verify payload has metadata prefix
    const payload = packet.slice(12).toString('utf-8');
    expect(payload).toBe('MD:hello world');
  });
  
  it('should create a multiplexed metadata packet', () => {
    const options: Partial<RtpConfig> & { metadataPacket: boolean } = {
      multiplexEnabled: true,
      useCsrcForStreamId: true,
      streamIdentifier: 'test-stream',
      csrcList: [42],
      metadataPacket: true,
    };
    
    const packet = createRtpPacket(testSequence, testTimestamp, testText, options);
    
    // Verify CSRC and metadata flags
    expect(packet[0] & 0x0F).toBe(1); // CSRC count of 1
    expect(packet[1] & 0x80).toBe(0x80); // Marker bit for metadata
    expect(packet.readUInt32BE(12)).toBe(42); // CSRC value
    
    // Verify payload has metadata prefix after CSRC
    const payload = packet.slice(16).toString('utf-8');
    expect(payload).toBe('MD:hello world');
  });
  
  it('should create a packet with multiple CSRC identifiers', () => {
    const options: Partial<RtpConfig> = {
      multiplexEnabled: true,
      csrcList: [101, 102, 103], // Multiple CSRC IDs
    };
    
    const packet = createRtpPacket(testSequence, testTimestamp, testText, options);
    
    // Verify CSRC count
    expect(packet[0] & 0x0F).toBe(3); // CSRC count of 3
    
    // Verify each CSRC value
    expect(packet.readUInt32BE(12)).toBe(101); // First CSRC
    expect(packet.readUInt32BE(16)).toBe(102); // Second CSRC
    expect(packet.readUInt32BE(20)).toBe(103); // Third CSRC
    
    // Verify payload starts after all CSRC fields
    const payload = packet.slice(24).toString('utf-8');
    expect(payload).toBe(testText);
  });
  
  it('should properly handle combined options', () => {
    // Test with multiple options combined
    const options: Partial<RtpConfig> & { metadataPacket: boolean } = {
      payloadType: 99,
      multiplexEnabled: true,
      useCsrcForStreamId: false,
      streamIdentifier: 'test-stream',
      ssrc: 987654321,
      metadataPacket: true,
    };
    
    const packet = createRtpPacket(testSequence, testTimestamp, testText, options);
    
    // Verify header fields
    expect(packet[1] & 0x7F).toBe(99); // Custom payload type
    expect(packet[1] & 0x80).toBe(0x80); // Marker bit set
    expect(packet.readUInt32BE(8)).toBe(987654321); // SSRC
    
    // Verify payload
    const payload = packet.slice(12).toString('utf-8');
    expect(payload).toBe('MD:hello world'); // Metadata prefix takes precedence over stream ID
  });
});