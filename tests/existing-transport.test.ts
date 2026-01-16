import {
  processAIStream,
  processAIStreamToRtp,
  processAIStreamToSrtp,
  processAIStreamToDirectSocket,
  T140RtpTransport,
  TransportStream,
} from '../src';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

/**
 * Tests for the existingTransport parameter bug fix.
 *
 * Bug description: When existingTransport was provided to processAIStreamTo*
 * functions, the code would create a NEW transport and attach the stream to it,
 * but then return the existingTransport. This meant the stream was connected
 * to a transport that was never returned, and the returned transport never
 * received any data.
 *
 * Fix: The functions now properly attach the stream directly to the
 * existingTransport when provided, and return that same transport instance.
 */

/**
 * Mock data stream for testing
 */
class MockDataStream extends EventEmitter {
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

/**
 * Custom transport implementation for testing
 */
class TestTransport implements TransportStream {
  public sentPackets: Buffer[] = [];
  public closed: boolean = false;

  send(data: Buffer, callback?: (error?: Error) => void): void {
    this.sentPackets.push(Buffer.from(data));
    if (callback) callback();
  }

  close(): void {
    this.closed = true;
  }
}

describe('existingTransport Parameter Fix', () => {
  describe('processAIStreamToRtp with existingTransport', () => {
    let existingTransport: T140RtpTransport;
    let customTransport: TestTransport;
    let stream: MockDataStream;

    beforeEach(() => {
      jest.useFakeTimers();
      customTransport = new TestTransport();
      stream = new MockDataStream();

      // Create the "existing" transport that we'll pass to the function
      existingTransport = new T140RtpTransport('127.0.0.1', 5004, {
        customTransport,
        payloadType: 96,
        ssrc: 12345,
        initialSequenceNumber: 100,
        initialTimestamp: 1000,
      });
    });

    afterEach(() => {
      jest.clearAllMocks();
      jest.useRealTimers();
    });

    test('should return the exact same transport instance when existingTransport is provided', () => {
      const returnedTransport = processAIStreamToRtp(
        stream,
        '127.0.0.1',
        5004,
        { charRateLimit: 1000 },
        existingTransport
      );

      // The returned transport should be the exact same object
      expect(returnedTransport).toBe(existingTransport);
    });

    test('should send data through the existingTransport, not a new transport', () => {
      const sendSpy = jest.spyOn(customTransport, 'send');

      processAIStreamToRtp(
        stream,
        '127.0.0.1',
        5004,
        { charRateLimit: 1000 },
        existingTransport
      );

      // Emit some data
      stream.emitData('Hello World');

      // Fast-forward time to process rate limiting
      jest.advanceTimersByTime(200);

      // The data should have been sent through our existing transport's custom transport
      expect(sendSpy).toHaveBeenCalled();
      expect(customTransport.sentPackets.length).toBeGreaterThan(0);

      // Verify the payload contains our text
      const allPayloads = customTransport.sentPackets
        .map((packet) => packet.slice(12).toString('utf8'))
        .join('');

      expect(allPayloads).toContain('Hello');
    });

    test('should close the existingTransport when stream ends', () => {
      const closeSpy = jest.spyOn(existingTransport, 'close');

      processAIStreamToRtp(
        stream,
        '127.0.0.1',
        5004,
        { charRateLimit: 1000 },
        existingTransport
      );

      expect(customTransport.closed).toBe(false);
      stream.emitEnd();

      jest.runOnlyPendingTimers();

      expect(closeSpy).toHaveBeenCalled();
      expect(customTransport.closed).toBe(true);
    });

    test('should close the existingTransport when stream errors', () => {
      const closeSpy = jest.spyOn(existingTransport, 'close');

      processAIStreamToRtp(
        stream,
        '127.0.0.1',
        5004,
        { charRateLimit: 1000 },
        existingTransport
      );

      expect(customTransport.closed).toBe(false);
      stream.emitError(new Error('Test error'));

      jest.runOnlyPendingTimers();

      expect(closeSpy).toHaveBeenCalled();
      expect(customTransport.closed).toBe(true);
    });
  });

  describe('processAIStreamToSrtp with existingTransport', () => {
    let existingTransport: T140RtpTransport;
    let customTransport: TestTransport;
    let stream: MockDataStream;

    const srtpConfig = {
      masterKey: Buffer.alloc(16, 0xaa),
      masterSalt: Buffer.alloc(14, 0xbb),
    };

    beforeEach(() => {
      jest.useFakeTimers();
      customTransport = new TestTransport();
      stream = new MockDataStream();

      // Create the "existing" transport
      existingTransport = new T140RtpTransport('127.0.0.1', 5006, {
        customTransport,
        payloadType: 96,
        ssrc: 54321,
        initialSequenceNumber: 200,
        initialTimestamp: 2000,
      });
    });

    afterEach(() => {
      jest.clearAllMocks();
      jest.useRealTimers();
    });

    test('should return the exact same transport instance when existingTransport is provided', () => {
      const returnedTransport = processAIStreamToSrtp(
        stream,
        '127.0.0.1',
        srtpConfig,
        5006,
        existingTransport
      );

      // The returned transport should be the exact same object
      expect(returnedTransport).toBe(existingTransport);
    });

    test('should send data through the existingTransport, not a new transport', () => {
      const sendTextSpy = jest.spyOn(existingTransport, 'sendText');

      processAIStreamToSrtp(
        stream,
        '127.0.0.1',
        srtpConfig,
        5006,
        existingTransport
      );

      // Emit some data
      stream.emitData('SRTP Test Data');

      jest.advanceTimersByTime(100);

      // sendText should have been called on the existing transport
      expect(sendTextSpy).toHaveBeenCalledWith('SRTP Test Data');
    });

    test('should close the existingTransport when stream ends', () => {
      const closeSpy = jest.spyOn(existingTransport, 'close');

      processAIStreamToSrtp(
        stream,
        '127.0.0.1',
        srtpConfig,
        5006,
        existingTransport
      );

      expect(customTransport.closed).toBe(false);
      stream.emitEnd();

      jest.runOnlyPendingTimers();

      expect(closeSpy).toHaveBeenCalled();
      expect(customTransport.closed).toBe(true);
    });

    test('should close the existingTransport when stream errors', () => {
      const closeSpy = jest.spyOn(existingTransport, 'close');

      processAIStreamToSrtp(
        stream,
        '127.0.0.1',
        srtpConfig,
        5006,
        existingTransport
      );

      expect(customTransport.closed).toBe(false);
      stream.emitError(new Error('SRTP test error'));

      jest.runOnlyPendingTimers();

      expect(closeSpy).toHaveBeenCalled();
      expect(customTransport.closed).toBe(true);
    });

    test('should call setupSrtp on the existingTransport', () => {
      const setupSrtpSpy = jest.spyOn(existingTransport, 'setupSrtp');

      processAIStreamToSrtp(
        stream,
        '127.0.0.1',
        srtpConfig,
        5006,
        existingTransport
      );

      // setupSrtp should have been called with the config
      expect(setupSrtpSpy).toHaveBeenCalledWith(srtpConfig);
    });
  });

  describe('processAIStreamToDirectSocket with existingTransport', () => {
    let existingTransport: TestTransport;
    let stream: MockDataStream;

    beforeEach(() => {
      jest.useFakeTimers();
      existingTransport = new TestTransport();
      stream = new MockDataStream();
    });

    afterEach(() => {
      jest.clearAllMocks();
      jest.useRealTimers();
    });

    test('should return the exact same transport instance when existingTransport is provided', () => {
      const returnedTransport = processAIStreamToDirectSocket(
        stream,
        '/test/socket',
        {},
        existingTransport
      );

      // The returned transport should be the exact same object
      expect(returnedTransport).toBe(existingTransport);
    });

    test('should send data through the existingTransport, not a new transport', () => {
      const sendSpy = jest.spyOn(existingTransport, 'send');

      processAIStreamToDirectSocket(
        stream,
        '/test/socket',
        {},
        existingTransport
      );

      // Emit some data
      stream.emitData('Direct Socket Test');

      jest.advanceTimersByTime(100);

      // The send method should have been called on our existing transport
      expect(sendSpy).toHaveBeenCalled();
      expect(existingTransport.sentPackets.length).toBeGreaterThan(0);

      // Verify the payload contains our text (after RTP header)
      const allPayloads = existingTransport.sentPackets
        .map((packet) => packet.slice(12).toString('utf8'))
        .join('');

      expect(allPayloads).toContain('Direct Socket Test');
    });

    test('should close the existingTransport when stream ends', () => {
      const closeSpy = jest.spyOn(existingTransport, 'close');

      processAIStreamToDirectSocket(
        stream,
        '/test/socket',
        {},
        existingTransport
      );

      expect(existingTransport.closed).toBe(false);
      stream.emitEnd();

      jest.runOnlyPendingTimers();

      expect(closeSpy).toHaveBeenCalled();
      expect(existingTransport.closed).toBe(true);
    });

    test('should close the existingTransport when stream errors', () => {
      const closeSpy = jest.spyOn(existingTransport, 'close');

      processAIStreamToDirectSocket(
        stream,
        '/test/socket',
        {},
        existingTransport
      );

      expect(existingTransport.closed).toBe(false);
      stream.emitError(new Error('Direct socket test error'));

      jest.runOnlyPendingTimers();

      expect(closeSpy).toHaveBeenCalled();
      expect(existingTransport.closed).toBe(true);
    });
  });

  describe('processAIStream with existingConnection (WebSocket)', () => {
    let existingConnection: WebSocket;
    let stream: MockDataStream;

    beforeEach(() => {
      jest.useFakeTimers();
      stream = new MockDataStream();

      // Create a mock WebSocket with necessary methods
      existingConnection = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn(),
        once: jest.fn(),
        off: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      } as unknown as WebSocket;
    });

    afterEach(() => {
      jest.clearAllMocks();
      jest.useRealTimers();
    });

    test('should return the exact same connection instance when existingConnection is provided', () => {
      const returnedConnection = processAIStream(
        stream,
        'ws://localhost:8080',
        {},
        existingConnection
      );

      // The returned connection should be the exact same object
      expect(returnedConnection).toBe(existingConnection);
    });

    test('should send data through the existingConnection, not a new connection', () => {
      processAIStream(
        stream,
        'ws://localhost:8080',
        {},
        existingConnection
      );

      // Emit some data
      stream.emitData('WebSocket Test Data');

      jest.advanceTimersByTime(100);

      // The send method should have been called on our existing connection
      expect(existingConnection.send).toHaveBeenCalledWith('WebSocket Test Data');
    });

    test('should close the existingConnection when stream ends', () => {
      processAIStream(
        stream,
        'ws://localhost:8080',
        {},
        existingConnection
      );

      stream.emitEnd();

      jest.runOnlyPendingTimers();

      expect(existingConnection.close).toHaveBeenCalled();
    });

    test('should close the existingConnection when stream errors', () => {
      processAIStream(
        stream,
        'ws://localhost:8080',
        {},
        existingConnection
      );

      stream.emitError(new Error('WebSocket test error'));

      jest.runOnlyPendingTimers();

      expect(existingConnection.close).toHaveBeenCalled();
    });
  });

  describe('Regression: New transport creation still works', () => {
    let stream: MockDataStream;

    beforeEach(() => {
      jest.useFakeTimers();
      stream = new MockDataStream();
    });

    afterEach(() => {
      jest.clearAllMocks();
      jest.useRealTimers();
    });

    test('processAIStreamToRtp creates new transport when no existingTransport provided', () => {
      const customTransport = new TestTransport();

      const transport = processAIStreamToRtp(stream, '127.0.0.1', 5004, {
        customTransport,
        charRateLimit: 1000,
      });

      // Should return a T140RtpTransport
      expect(transport).toBeInstanceOf(T140RtpTransport);
      expect(transport.remoteAddress).toBe('127.0.0.1');
      expect(transport.remotePort).toBe(5004);

      // Stream data should work
      stream.emitData('Test');
      jest.advanceTimersByTime(200);

      expect(customTransport.sentPackets.length).toBeGreaterThan(0);
    });

    test('processAIStreamToSrtp creates new transport when no existingTransport provided', () => {
      const customTransport = new TestTransport();

      const srtpConfig = {
        masterKey: Buffer.alloc(16, 0xaa),
        masterSalt: Buffer.alloc(14, 0xbb),
        customTransport,
      };

      const transport = processAIStreamToSrtp(
        stream,
        '127.0.0.1',
        srtpConfig,
        5006
      );

      // Should return a T140RtpTransport
      expect(transport).toBeInstanceOf(T140RtpTransport);
      expect(transport.remoteAddress).toBe('127.0.0.1');
      expect(transport.remotePort).toBe(5006);
    });

    test('processAIStreamToDirectSocket creates new socket when no existingTransport provided', () => {
      // This test just verifies the function returns something with expected methods
      const transport = processAIStreamToDirectSocket(
        stream,
        '/test/socket/path'
      );

      expect(transport).toBeDefined();
      // The returned socket should have write and end methods
      expect(typeof (transport as any).write).toBe('function');
      expect(typeof (transport as any).end).toBe('function');
    });
  });
});
