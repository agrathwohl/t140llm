import { T140RtpTransport } from '../src/rtp/t140-rtp-transport';
import { TransportStream } from '../src/interfaces';
import { extractT140Text } from '../src/utils/parse-red-packet';

const mockUdp = {
  send: jest.fn((_buf: Buffer, _off: number, _len: number, _port: number, _addr: string, cb?: () => void) => cb?.()),
  close: jest.fn(),
  on: jest.fn(),
};
jest.mock('dgram', () => ({ createSocket: jest.fn(() => mockUdp) }));

function capture(): { sent: Buffer[]; closed: number; transport: TransportStream } {
  const state = {
    sent: [] as Buffer[],
    closed: 0,
    transport: {
      send(buf: Buffer, cb?: (err?: Error) => void) { state.sent.push(Buffer.from(buf)); cb?.(); },
      close() { state.closed++; },
    } as TransportStream,
  };
  return state;
}

describe('T140RtpTransport', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sends over UDP to the default RTP port', () => {
    const transport = new T140RtpTransport('192.168.1.1');
    transport.sendText('hi');

    expect(mockUdp.send).toHaveBeenCalledTimes(1);
    const [buf, offset, length, port, address] = mockUdp.send.mock.calls[0];
    expect(extractT140Text(buf.slice(offset, offset + length))).toBe('hi');
    expect(port).toBe(5004);
    expect(address).toBe('192.168.1.1');
  });

  test('rejects an invalid remote address', () => {
    expect(() => new T140RtpTransport('not a host!')).toThrow('Invalid remote address format');
  });

  test('sends text as an RTP packet with the configured header fields', () => {
    const { sent, transport: customTransport } = capture();
    const transport = new T140RtpTransport('127.0.0.1', 5004, {
      customTransport, ssrc: 777, initialSequenceNumber: 100, payloadType: 100, redEnabled: false,
    });

    transport.sendText('Hello T.140');

    expect(sent).toHaveLength(1);
    expect(sent[0][0] >> 6).toBe(2);
    expect(sent[0][1] & 0x7f).toBe(100);
    expect(sent[0].readUInt16BE(2)).toBe(100);
    expect(sent[0].readUInt32BE(8)).toBe(777);
    expect(sent[0].slice(12).toString()).toBe('Hello T.140');
  });

  test('starts sequence numbers at 0 and increments by one per packet', () => {
    const { sent, transport: customTransport } = capture();
    const transport = new T140RtpTransport('127.0.0.1', 5004, { customTransport, ssrc: 1 });

    transport.sendText('a');
    transport.sendText('b');

    expect(sent.map((p) => p.readUInt16BE(2))).toEqual([0, 1]);
  });

  test('timestamps advance by timestampIncrement when set', () => {
    const { sent, transport: customTransport } = capture();
    const transport = new T140RtpTransport('127.0.0.1', 5004, {
      customTransport, ssrc: 1, initialTimestamp: 1000, timestampIncrement: 50,
    });

    transport.sendText('a');
    transport.sendText('b');

    const [t0, t1] = sent.map((p) => p.readUInt32BE(4));
    expect(t1 - t0).toBe(50);
  });

  test('uses the RED payload type 98 for every packet when redEnabled', () => {
    const { sent, transport: customTransport } = capture();
    const transport = new T140RtpTransport('127.0.0.1', 5004, { customTransport, ssrc: 1, redEnabled: true });

    transport.sendText('a');
    transport.sendText('b');

    expect(sent.map((p) => p[1] & 0x7f)).toEqual([98, 98]);
  });

  test('closes the custom transport on close', () => {
    const cap = capture();
    const transport = new T140RtpTransport('127.0.0.1', 5004, { customTransport: cap.transport });

    transport.close();

    expect(cap.closed).toBe(1);
  });

  test('close is idempotent', () => {
    const cap = capture();
    const transport = new T140RtpTransport('127.0.0.1', 5004, { customTransport: cap.transport });

    transport.close();
    transport.close();

    expect(cap.closed).toBe(1);
  });

  test('closes the UDP socket on close', () => {
    new T140RtpTransport('127.0.0.1').close();
    expect(mockUdp.close).toHaveBeenCalledTimes(1);
  });

  test('sendText after close sends nothing', () => {
    const cap = capture();
    const transport = new T140RtpTransport('127.0.0.1', 5004, { customTransport: cap.transport });

    transport.close();
    transport.sendText('late');

    expect(cap.sent).toHaveLength(0);
  });

  describe('setupSrtp', () => {
    const srtpConfig = { masterKey: Buffer.alloc(16, 0xaa), masterSalt: Buffer.alloc(14, 0xbb) };

    test('encrypts the payload and appends an authentication tag', () => {
      const { sent, transport: customTransport } = capture();
      const transport = new T140RtpTransport('127.0.0.1', 5004, { customTransport, ssrc: 1, redEnabled: false });
      transport.setupSrtp(srtpConfig);

      transport.sendText('secret text');

      expect(sent).toHaveLength(1);
      expect(sent[0].length).toBe(12 + 'secret text'.length + 10);
      expect(sent[0].includes(Buffer.from('secret text'))).toBe(false);
    });

    test('throws when the master key is not 16 bytes', () => {
      const transport = new T140RtpTransport('127.0.0.1', 5004, { customTransport: capture().transport });
      expect(() => transport.setupSrtp({ ...srtpConfig, masterKey: Buffer.alloc(8) }))
        .toThrow('SRTP masterKey must be 16 bytes');
    });

    test('throws when the master salt is not 14 bytes', () => {
      const transport = new T140RtpTransport('127.0.0.1', 5004, { customTransport: capture().transport });
      expect(() => transport.setupSrtp({ ...srtpConfig, masterSalt: Buffer.alloc(8) }))
        .toThrow('SRTP masterSalt must be 14 bytes');
    });

    test('refuses to combine with fecEnabled', () => {
      const transport = new T140RtpTransport('127.0.0.1', 5004, {
        customTransport: capture().transport, fecEnabled: true,
      });
      expect(() => transport.setupSrtp(srtpConfig)).toThrow('fecEnabled cannot be combined with SRTP');
    });
  });
});
