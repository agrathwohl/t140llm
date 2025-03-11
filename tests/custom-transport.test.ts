import { T140RtpTransport, processAIStreamToRtp, TransportStream } from '../src';
import { EventEmitter } from 'events';

/**
 * Custom transport implementation for testing
 */
class TestTransport implements TransportStream {
  public sentPackets: Buffer[] = [];
  public closed: boolean = false;

  send(data: Buffer, callback?: (error?: Error) => void): void {
    this.sentPackets.push(Buffer.from(data)); // Copy the buffer
    if (callback) callback();
  }

  close(): void {
    this.closed = true;
  }
}

/**
 * Mock data stream for testing
 */
class MockDataStream extends EventEmitter {
  constructor() {
    super();
  }

  emitData(text: string): void {
    this.emit('data', text);
  }

  emitEnd(): void {
    this.emit('end');
  }

  emitError(error: Error): void {
    this.emit('error', error);
  }
}

describe('Custom Transport', () => {
  describe('T140RtpTransport with custom transport', () => {
    let customTransport: TestTransport;
    let transport: T140RtpTransport;

    beforeEach(() => {
      customTransport = new TestTransport();
      transport = new T140RtpTransport('127.0.0.1', 5004, {
        customTransport,
        payloadType: 96,
        ssrc: 12345,
        initialSequenceNumber: 100,
        initialTimestamp: 1000,
      });
    });

    test('should send packets through custom transport', () => {
      // Mock the send method to verify it's called
      const sendSpy = jest.spyOn(customTransport, 'send');
      
      transport.sendText('Hello');
      expect(sendSpy).toHaveBeenCalled();
      expect(customTransport.sentPackets.length).toBe(1);
      
      // The packet should have RTP header (12 bytes) + payload
      const packet = customTransport.sentPackets[0];
      expect(packet.length).toBeGreaterThan(12); // RTP header + payload

      // Check that payload contains our text
      const payload = packet.slice(12).toString('utf8');
      expect(payload).toBe('Hello');
      
      sendSpy.mockRestore();
    });
    
    test('should use _sendPacket method to send via custom transport', () => {
      // Access the private _sendPacket method using any cast
      const sendPacketMethod = (transport as any)._sendPacket.bind(transport);
      
      // Mock the send method to verify it's called
      const sendSpy = jest.spyOn(customTransport, 'send');
      
      // Create a test packet
      const testPacket = Buffer.from('test packet');
      
      // Call the _sendPacket method directly
      sendPacketMethod(testPacket);
      
      // Verify the custom transport's send method was called
      expect(sendSpy).toHaveBeenCalled();
      expect(customTransport.sentPackets.length).toBe(1);
      expect(customTransport.sentPackets[0].toString()).toBe('test packet');
    });

    test('should close custom transport when transport is closed', () => {
      // Mock the close method to verify it's called
      const closeSpy = jest.spyOn(customTransport, 'close');
      
      expect(customTransport.closed).toBe(false);
      transport.close();
      
      expect(closeSpy).toHaveBeenCalled();
      expect(customTransport.closed).toBe(true);
      
      closeSpy.mockRestore();
    });
  });

  describe('processAIStreamToRtp with custom transport', () => {
    let customTransport: TestTransport;
    let stream: MockDataStream;
    let transport: T140RtpTransport;

    beforeEach(() => {
      // Set up jest fake timers to control setTimeout/setInterval
      jest.useFakeTimers();
      
      customTransport = new TestTransport();
      stream = new MockDataStream();
      
      // Create a spy on the transport's send method
      jest.spyOn(customTransport, 'send');
      
      transport = processAIStreamToRtp(stream, '127.0.0.1', 5004, {
        customTransport,
        payloadType: 96,
        ssrc: 12345,
        // Disable rate limiting for tests to make them more predictable
        charRateLimit: 1000
      });
    });
    
    afterEach(() => {
      // Restore all mocks and timers
      jest.clearAllMocks();
      jest.useRealTimers();
    });

    test('should send stream data through custom transport', () => {
      stream.emitData('Test message');
      
      // Fast-forward time to process the rate limiting
      jest.advanceTimersByTime(200);
      
      // Check that the send method was called on the custom transport
      expect(customTransport.send).toHaveBeenCalled();
      
      // Check that at least one packet was sent
      expect(customTransport.sentPackets.length).toBeGreaterThan(0);
      
      // Combine all packet payloads to check if our text was sent
      // (it might be split into multiple packets due to rate limiting)
      const allPayloads = customTransport.sentPackets
        .map(packet => packet.slice(12).toString('utf8'))
        .join('');
        
      expect(allPayloads).toContain('Test');
    });

    test('should close custom transport when stream ends', () => {
      // Mock the close method to verify it's called
      const closeSpy = jest.spyOn(customTransport, 'close');
      
      expect(customTransport.closed).toBe(false);
      stream.emitEnd();
      
      // Run any pending timers to make sure intervals are cleared
      jest.runOnlyPendingTimers();
      
      // Verify the close method was called
      expect(closeSpy).toHaveBeenCalled();
      expect(customTransport.closed).toBe(true);
    });

    test('should close custom transport when stream errors', () => {
      // Mock the close method to verify it's called
      const closeSpy = jest.spyOn(customTransport, 'close');
      
      expect(customTransport.closed).toBe(false);
      stream.emitError(new Error('Test error'));
      
      // Run any pending timers to make sure intervals are cleared
      jest.runOnlyPendingTimers();
      
      // Verify the close method was called
      expect(closeSpy).toHaveBeenCalled();
      expect(customTransport.closed).toBe(true);
    });
  });
});