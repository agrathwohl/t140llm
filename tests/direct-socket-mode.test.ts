import * as net from 'net';
import { EventEmitter } from 'events';
import { processAIStreamToDirectSocket } from '../src/processors/process-ai-stream-to-direct-socket';

jest.mock('net', () => {
  const { EventEmitter: Emitter } = require('events');
  return {
    ...jest.requireActual('net'),
    createConnection: jest.fn(() => Object.assign(new Emitter(), { write: jest.fn(), end: jest.fn() })),
  };
});

const payload = (call: unknown[]): string => (call[0] as Buffer).slice(12).toString('utf8');

describe('Direct Socket Mode', () => {
  let stream: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    stream = new EventEmitter();
  });

  test('connects to the specified socket path', () => {
    processAIStreamToDirectSocket(stream, '/custom/socket/path');

    expect(net.createConnection).toHaveBeenCalledWith('/custom/socket/path');
  });

  test('sends text to socket with RTP encapsulation', () => {
    const socket = processAIStreamToDirectSocket(stream, '/s', { ssrc: 4242 }) as any;

    stream.emit('data', 'Hello');

    expect(socket.write).toHaveBeenCalledTimes(1);
    const packet: Buffer = socket.write.mock.calls[0][0];
    expect(packet[0] >> 6).toBe(2);
    expect(packet.readUInt32BE(8)).toBe(4242);
    expect(payload(socket.write.mock.calls[0])).toBe('Hello');
  });

  test('handles multiple data chunks with incrementing sequence numbers', () => {
    const socket = processAIStreamToDirectSocket(stream, '/s') as any;

    stream.emit('data', 'one');
    stream.emit('data', 'two');

    const calls: unknown[][] = socket.write.mock.calls;
    expect(calls.map(payload)).toEqual(['one', 'two']);
    expect(calls.map((c) => (c[0] as Buffer).readUInt16BE(2))).toEqual([0, 1]);
  });

  test('closes socket when stream ends', () => {
    const socket = processAIStreamToDirectSocket(stream, '/s') as any;

    stream.emit('end');

    expect(socket.end).toHaveBeenCalledTimes(1);
  });

  test('closes socket when stream errors', () => {
    const socket = processAIStreamToDirectSocket(stream, '/s', { onError: () => undefined }) as any;

    stream.emit('error', new Error('boom'));

    expect(socket.end).toHaveBeenCalledTimes(1);
  });

  test('reports socket errors through onError', () => {
    const onError = jest.fn();
    const socket = processAIStreamToDirectSocket(stream, '/s', { onError }) as any;
    const err = new Error('socket failed');

    socket.emit('error', err);

    expect(onError).toHaveBeenCalledWith(err);
  });

  test('uses customTransport instead of opening a socket', () => {
    const sent: Buffer[] = [];
    const customTransport = { send: (b: Buffer) => { sent.push(Buffer.from(b)); }, close: jest.fn() };

    const result = processAIStreamToDirectSocket(stream, '/s', { customTransport });
    stream.emit('data', 'hi');

    expect(net.createConnection).not.toHaveBeenCalled();
    expect(result).toBe(customTransport);
    expect(sent.map((p) => p.slice(12).toString())).toEqual(['hi']);
  });
});
