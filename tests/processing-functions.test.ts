import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { processAIStream } from '../src/processors/process-ai-stream';
import { processAIStreamToRtp } from '../src/processors/process-ai-stream-to-rtp';
import { processAIStreamToSrtp } from '../src/processors/process-ai-stream-to-srtp';
import { processAIStreamToDirectSocket } from '../src/processors/process-ai-stream-to-direct-socket';
import { createSrtpKeysFromPassphrase } from '../src/utils/security';
import { extractT140Text } from '../src/utils/parse-red-packet';

jest.mock('ws');

const capture = () => {
  const sent: Buffer[] = [];
  return { sent, customTransport: { send: (b: Buffer) => { sent.push(Buffer.from(b)); }, close: jest.fn() } };
};

describe('Processing Functions', () => {
  let mockStream: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStream = new EventEmitter();
  });

  describe('processAIStream (WebSocket mode)', () => {
    test('opens a client to the given URL and buffers text until the socket opens', () => {
      const ws = processAIStream(mockStream, 'ws://example.com:9999') as any;
      expect(WebSocket).toHaveBeenCalledWith('ws://example.com:9999', {});

      mockStream.emit('data', 'early');
      expect(ws.send).not.toHaveBeenCalled();

      ws.readyState = WebSocket.OPEN;
      const onOpen = ws.on.mock.calls.find(([event]: [string]) => event === 'open')[1];
      onOpen();

      expect(ws.send).toHaveBeenCalledWith('early');
    });

    test('closes the socket once it is open and the stream has ended', () => {
      const ws = processAIStream(mockStream, 'ws://example.com:9999') as any;
      ws.readyState = WebSocket.OPEN;

      mockStream.emit('end');

      expect(ws.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('processAIStreamToRtp', () => {
    test('sends stream text as an RTP packet through the transport', () => {
      const { sent, customTransport } = capture();
      processAIStreamToRtp(mockStream, '127.0.0.1', 5004, { customTransport, ssrc: 99 });

      mockStream.emit('data', 'Hello');

      expect(sent).toHaveLength(1);
      expect(sent[0].readUInt32BE(8)).toBe(99);
      expect(extractT140Text(sent[0])).toBe('Hello');
    });

    test('closes the transport when the queue is empty and the stream ends', () => {
      const { customTransport } = capture();
      processAIStreamToRtp(mockStream, '127.0.0.1', 5004, { customTransport });

      mockStream.emit('data', 'Hello');
      mockStream.emit('end');

      expect(customTransport.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('processAIStreamToSrtp', () => {
    test('sends stream text encrypted with an authentication tag', () => {
      const { sent, customTransport } = capture();
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('test-key');
      processAIStreamToSrtp(mockStream, '127.0.0.1', 5006, { masterKey, masterSalt, redEnabled: false, customTransport });

      mockStream.emit('data', 'Hello');

      expect(sent).toHaveLength(1);
      expect(sent[0].length).toBe(12 + 'Hello'.length + 10);
      expect(sent[0].includes(Buffer.from('Hello'))).toBe(false);
    });

    test('throws when the master key is not 16 bytes', () => {
      const { customTransport } = capture();
      const srtpConfig = { masterKey: Buffer.from('test-key'), masterSalt: Buffer.alloc(14), customTransport };

      expect(() => processAIStreamToSrtp(mockStream, '127.0.0.1', 5006, srtpConfig))
        .toThrow('SRTP masterKey must be 16 bytes');
    });
  });

  describe('processAIStreamToDirectSocket', () => {
    test('writes one RTP packet per chunk to the custom transport', () => {
      const { sent, customTransport } = capture();
      const result = processAIStreamToDirectSocket(mockStream, '/test/socket/path', { customTransport });

      mockStream.emit('data', 'Hello');

      expect(result).toBe(customTransport);
      expect(sent.map((p) => p.slice(12).toString())).toEqual(['Hello']);
    });
  });

  describe('createSrtpKeysFromPassphrase', () => {
    test('generates keys and salt from passphrase', () => {
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('test-passphrase');

      expect(Buffer.isBuffer(masterKey)).toBe(true);
      expect(Buffer.isBuffer(masterSalt)).toBe(true);
      expect(masterKey.length).toBe(16);
      expect(masterSalt.length).toBe(14);
    });
  });
});
