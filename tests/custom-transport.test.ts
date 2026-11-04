import { EventEmitter } from 'events';
import { T140RtpTransport } from '../src/rtp/t140-rtp-transport';
import { processAIStreamToRtp } from '../src/processors/process-ai-stream-to-rtp';
import { TransportStream } from '../src/interfaces';
import { extractT140Text } from '../src/utils/parse-red-packet';

class TestTransport implements TransportStream {
  public sentPackets: Buffer[] = [];
  public closed = false;

  send(data: Buffer, callback?: (error?: Error) => void): void {
    this.sentPackets.push(Buffer.from(data));
    if (callback) callback();
  }

  close(): void {
    this.closed = true;
  }
}

const payloads = (t: TestTransport): string[] => t.sentPackets.map((p) => extractT140Text(p));

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
      transport.sendText('Hello');

      expect(customTransport.sentPackets).toHaveLength(1);
      expect(payloads(customTransport)).toEqual(['Hello']);
    });

    test('should frame packets with the configured sequence number and SSRC', () => {
      transport.sendText('Hello');

      const packet = customTransport.sentPackets[0];
      expect(packet.readUInt16BE(2)).toBe(100);
      expect(packet.readUInt32BE(8)).toBe(12345);
    });

    test('should close custom transport when transport is closed', () => {
      expect(customTransport.closed).toBe(false);
      transport.close();
      expect(customTransport.closed).toBe(true);
    });
  });

  describe('processAIStreamToRtp with custom transport', () => {
    let customTransport: TestTransport;
    let stream: EventEmitter;

    beforeEach(() => {
      customTransport = new TestTransport();
      stream = new EventEmitter();
      processAIStreamToRtp(stream, '127.0.0.1', 5004, { customTransport, payloadType: 96, ssrc: 12345 });
    });

    test('should send stream data through custom transport', () => {
      stream.emit('data', 'Test message');

      expect(payloads(customTransport).join('')).toBe('Test message');
    });

    test('should set the marker bit on the first packet after idle', () => {
      stream.emit('data', 'Test');

      expect(customTransport.sentPackets[0][1] & 0x80).toBe(0x80);
    });

    test('should close custom transport when stream ends', () => {
      expect(customTransport.closed).toBe(false);
      stream.emit('end');
      expect(customTransport.closed).toBe(true);
    });

    test('should close custom transport when stream errors', () => {
      expect(customTransport.closed).toBe(false);
      stream.emit('error', new Error('Test error'));
      expect(customTransport.closed).toBe(true);
    });
  });
});
