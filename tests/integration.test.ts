import { EventEmitter } from 'events';
import { processAIStream } from '../src/processors/process-ai-stream';
import { processAIStreamToRtp } from '../src/processors/process-ai-stream-to-rtp';
import { processAIStreamToSrtp } from '../src/processors/process-ai-stream-to-srtp';
import { processAIStreamToDirectSocket } from '../src/processors/process-ai-stream-to-direct-socket';
import { createSrtpKeysFromPassphrase } from '../src/utils/security';
import { extractT140Text } from '../src/utils/parse-red-packet';

/**
 * Integration-style tests: one AI stream through each processing mode, with
 * only the network I/O replaced by capturing transports.
 */
const capture = () => {
  const sent: Buffer[] = [];
  return { sent, customTransport: { send: (b: Buffer) => { sent.push(Buffer.from(b)); }, close: jest.fn() } };
};
const texts = (sent: Buffer[]): string[] => sent.map((p) => extractT140Text(p));

describe('Integration Tests', () => {
  let mockAIStream: EventEmitter;

  beforeEach(() => {
    mockAIStream = new EventEmitter();
  });

  test('should handle data from all supported AI stream formats', () => {
    const { sent, customTransport } = capture();
    processAIStreamToDirectSocket(mockAIStream, '/s', { customTransport });

    mockAIStream.emit('data', 'Plain text data');
    mockAIStream.emit('data', { choices: [{ delta: { content: 'Vercel AI format' } }] });
    mockAIStream.emit('data', { choices: [{ text: 'OpenAI format' }] });
    mockAIStream.emit('data', { delta: { text: 'Anthropic format 1' } });
    mockAIStream.emit('data', { content: [{ text: 'Anthropic format 2' }] });
    mockAIStream.emit('end');

    expect(texts(sent)).toEqual([
      'Plain text data',
      'Vercel AI format',
      'OpenAI format',
      'Anthropic format 1',
      'Anthropic format 2',
    ]);
    expect(customTransport.close).toHaveBeenCalledTimes(1);
  });

  test('should deliver the same text in every processing mode', () => {
    const ws = {
      readyState: 1, send: jest.fn(), close: jest.fn(), on: jest.fn(),
    } as any;
    processAIStream(mockAIStream, 'ws://localhost:1', {}, ws);

    const rtp = capture();
    processAIStreamToRtp(mockAIStream, '127.0.0.1', 5004, { customTransport: rtp.customTransport });

    const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('test-key');
    const srtp = capture();
    processAIStreamToSrtp(mockAIStream, '127.0.0.1', 5006, { masterKey, masterSalt, redEnabled: false, customTransport: srtp.customTransport });

    const direct = capture();
    processAIStreamToDirectSocket(mockAIStream, '/s', { customTransport: direct.customTransport });

    mockAIStream.emit('data', 'Test data');

    expect(ws.send).toHaveBeenCalledWith('Test data');
    expect(texts(rtp.sent)).toEqual(['Test data']);
    expect(texts(direct.sent)).toEqual(['Test data']);
    expect(srtp.sent).toHaveLength(1);
    expect(srtp.sent[0].length).toBe(12 + 'Test data'.length + 10);
  });

  test('direct socket mode should clean up like the other modes when the stream ends', () => {
    const direct = capture();
    const rtp = capture();
    processAIStreamToDirectSocket(mockAIStream, '/s', { customTransport: direct.customTransport });
    processAIStreamToRtp(mockAIStream, '127.0.0.1', 5004, { customTransport: rtp.customTransport });

    mockAIStream.emit('data', 'Test data');
    mockAIStream.emit('end');

    expect(direct.customTransport.close).toHaveBeenCalledTimes(1);
    expect(rtp.customTransport.close).toHaveBeenCalledTimes(1);
  });
});
