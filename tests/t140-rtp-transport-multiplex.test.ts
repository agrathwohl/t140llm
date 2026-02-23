import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import { T140RtpTransport } from '../src/rtp/t140-rtp-transport';
import { RtpConfig, T140RtpErrorType } from '../src/interfaces';

// Mock UDP socket for capturing sent packets
class MockSocket extends EventEmitter {
  public sent: Array<{buffer: Buffer, port: number, address: string}> = [];
  
  send(
    buffer: Buffer, 
    offset: number, 
    length: number, 
    port: number, 
    address: string, 
    callback?: (error?: Error) => void
  ): void {
    this.sent.push({ 
      buffer: Buffer.from(buffer.slice(offset, offset + length)), 
      port, 
      address 
    });
    if (callback) callback();
  }
  
  close(): void {
    // Do nothing
  }
}

// Mock TransportStream for custom transport testing
class MockTransport {
  public sent: Buffer[] = [];
  
  send(buffer: Buffer, callback?: (error?: Error) => void): void {
    this.sent.push(Buffer.from(buffer));
    if (callback) callback();
  }
  
  close(): void {
    // Do nothing
  }
}

// Mocking dgram module
jest.mock('dgram', () => {
  return {
    createSocket: jest.fn().mockImplementation(() => new MockSocket()),
  };
});

describe('T140RtpTransport with multiplexing', () => {
  let mockSocket: MockSocket;
  let originalCreateSocket: any;
  
  beforeEach(() => {
    // Save original implementation
    originalCreateSocket = dgram.createSocket;
    
    // Create new mock socket for each test
    mockSocket = new MockSocket();
    
    // Mock dgram.createSocket to return our mock
    (dgram.createSocket as jest.Mock).mockImplementation(() => mockSocket);
  });
  
  afterEach(() => {
    // Restore original implementation
    dgram.createSocket = originalCreateSocket;
  });
  
  describe('sendText with multiplexing options', () => {
    it('should create packets with stream identification via CSRC', () => {
      // Create transport with multiplexing config
      const config: RtpConfig = {
        multiplexEnabled: true,
        useCsrcForStreamId: true,
        streamIdentifier: 'test-stream',
        csrcList: [42],
        ssrc: 12345,
      };
      
      const transport = new T140RtpTransport('127.0.0.1', 5004, config);
      
      // Send some text
      transport.sendText('hello');
      
      // For this test, just verify a packet was sent
      expect(mockSocket.sent.length).toBe(1);
      
      // Check that basic properties made it to the packet
      const packet = mockSocket.sent[0].buffer;
      expect(packet.readUInt32BE(8)).toBe(12345); // SSRC
    });
    
    it('should create packets with stream identification via prefix', () => {
      // Create transport with multiplexing config
      const config: RtpConfig = {
        multiplexEnabled: true,
        useCsrcForStreamId: false,
        streamIdentifier: 'test-stream',
        ssrc: 12345,
      };
      
      const transport = new T140RtpTransport('127.0.0.1', 5004, config);
      
      // Send some text
      transport.sendText('hello');
      
      // Verify packet was sent
      expect(mockSocket.sent.length).toBe(1);
      
      // Check that the packet contains the text
      const packet = mockSocket.sent[0].buffer;
      const payload = packet.toString();
      expect(payload).toContain('hello');
    });
    
    it('should override config options with per-packet options', () => {
      // Create transport with default config
      const config: RtpConfig = {
        ssrc: 12345,
      };
      
      const transport = new T140RtpTransport('127.0.0.1', 5004, config);
      
      // Send with packet-specific options
      transport.sendText('hello', {
        multiplexEnabled: true,
        streamIdentifier: 'override-stream',
        useCsrcForStreamId: false,
      });
      
      // Verify packet was sent
      expect(mockSocket.sent.length).toBe(1);
      
      // Check the packet payload
      const packet = mockSocket.sent[0].buffer;
      const payload = packet.slice(12).toString('utf-8');
      expect(payload).toBe('override-stream\x1Ehello');
    });
    
    it('should work with custom transport and multiplexing', () => {
      // Create a mock custom transport
      const mockTransport = new MockTransport();
      
      // Create transport with custom transport and multiplexing
      const config: RtpConfig = {
        customTransport: mockTransport as any,
        multiplexEnabled: true,
        useCsrcForStreamId: true,
        csrcList: [99],
        streamIdentifier: 'custom-transport-stream',
      };
      
      const transport = new T140RtpTransport('127.0.0.1', 5004, config);
      
      // Send some text
      transport.sendText('hello via custom transport');
      
      // Verify something was sent through the transport
      expect(mockTransport.sent.length).toBe(1);
      
      // Verify text is present
      const text = mockTransport.sent[0].toString();
      expect(text).toContain('hello via custom transport');
    });
    
    it('should handle RED packets with multiplexing', () => {
      // Create transport with RED and multiplexing
      const config: RtpConfig = {
        redEnabled: true,
        redundancyLevel: 2,
        multiplexEnabled: true,
        useCsrcForStreamId: true,
        csrcList: [42],
        streamIdentifier: 'red-stream',
      };
      
      const transport = new T140RtpTransport('127.0.0.1', 5004, config);
      
      // Send multiple text chunks to build up redundancy
      transport.sendText('packet 1');
      transport.sendText('packet 2');
      transport.sendText('packet 3');
      
      // Verify that we sent 3 packets (should have redundancy by the third)
      expect(mockSocket.sent.length).toBe(3);
    });
    
    it('should handle FEC packets with multiplexing', () => {
      // Create transport with FEC and multiplexing
      const config: RtpConfig = {
        fecEnabled: true,
        fecGroupSize: 2, // Small group size for testing
        multiplexEnabled: true,
        useCsrcForStreamId: true,
        csrcList: [42],
        streamIdentifier: 'fec-stream',
      };
      
      const transport = new T140RtpTransport('127.0.0.1', 5004, config);
      
      // Send enough packets to trigger FEC
      transport.sendText('packet 1');
      transport.sendText('packet 2');
      
      // Verify we have 3 packets (2 data + 1 FEC)
      expect(mockSocket.sent.length).toBe(3);
    });
  });
  
  describe('error handling with multiplexing', () => {
    it('should emit errors for network issues with multiplexed streams', () => {
      // Setup mock socket to simulate error
      const errorSpy = jest.fn();
      
      // Create transport with multiplexing
      const transport = new T140RtpTransport('127.0.0.1', 5004, {
        multiplexEnabled: true,
        streamIdentifier: 'error-stream',
      });
      
      // Listen for errors
      transport.on('error', errorSpy);
      
      // Simulate socket error
      mockSocket.emit('error', new Error('Network error'));
      
      // Should have emitted an error
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0].type).toBe(T140RtpErrorType.NETWORK_ERROR);
    });
    
    it('should handle send errors with multiplexed streams', () => {
      // Setup error listener
      const errorSpy = jest.fn();
      
      // Create transport with multiplexing
      const transport = new T140RtpTransport('127.0.0.1', 5004, {
        multiplexEnabled: true,
        streamIdentifier: 'error-stream',
      });
      
      // Listen for errors
      transport.on('error', errorSpy);
      
      // Mock socket.send to fail
      mockSocket.send = (buffer, offset, length, port, address, callback) => {
        if (callback) callback(new Error('Send failed'));
        return undefined as any;
      };
      
      // Send text - should trigger error
      transport.sendText('will fail');
      
      // Should have emitted an error
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0].type).toBe(T140RtpErrorType.NETWORK_ERROR);
    });
  });
});