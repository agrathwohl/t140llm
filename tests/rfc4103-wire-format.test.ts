import { EventEmitter } from 'events';
import { TransportStream } from '../src/interfaces';
import { createRtpPacket } from '../src/rtp/create-rtp-packet';
import { T140RtpMultiplexer } from '../src/rtp/t140-rtp-multiplexer';
import { T140RtpTransport } from '../src/rtp/t140-rtp-transport';
import { SEND_INTERVAL_MS } from '../src/utils/constants';
import { T140StreamDemultiplexer } from '../src/utils/demultiplex-streams';
import { extractTextFromChunk } from '../src/utils/extract-text';
import { extractT140Text, parseT140RedPacket } from '../src/utils/parse-red-packet';
import { attachStreamProcessor, resolveStreamOptions } from '../src/utils/stream-processor';

function capture(): TransportStream & { sent: Buffer[] } {
  const sent: Buffer[] = [];
  return { sent, send: (b, cb) => { sent.push(Buffer.from(b)); cb?.(); }, close: () => undefined };
}

describe('text/red packets (RFC 2198 §3, RFC 4103 §4)', () => {
  it('writes 14-bit timestamp offsets, 10-bit lengths, oldest block first', () => {
    const wire = capture();
    const t = new T140RtpTransport('127.0.0.1', 5004, {
      customTransport: wire, redEnabled: true, redundancyLevel: 2, ssrc: 1, timestampIncrement: 100,
    });
    t.sendText('a');
    t.sendText('bb');
    t.sendText('ccc');

    const first = wire.sent[0];
    expect(first[1] & 0x7f).toBe(98);      // RED PT even with no redundant blocks yet
    expect(first[12]).toBe(96);            // F=0, primary block header
    expect(first.subarray(13).toString()).toBe('a');

    const p = wire.sent[2];
    expect(p[1] & 0x7f).toBe(98);
    expect(p.readUInt16BE(2)).toBe(2);
    const oldest = p.readUInt32BE(12);
    expect(oldest >>> 31).toBe(1);
    expect((oldest >>> 24) & 0x7f).toBe(96);
    expect((oldest >>> 10) & 0x3fff).toBe(200); // 'a' is two intervals old
    expect(oldest & 0x3ff).toBe(1);
    const newer = p.readUInt32BE(16);
    expect((newer >>> 10) & 0x3fff).toBe(100);
    expect(newer & 0x3ff).toBe(2);
    expect(p[20]).toBe(96);                 // primary header, F=0
    expect(p.subarray(21).toString()).toBe('abbccc');
    t.close();
  });

  it('keeps sending empty primaries after idle until every block went out twice (§5.2)', () => {
    jest.useFakeTimers();
    const wire = capture();
    const t = new T140RtpTransport('127.0.0.1', 5004, {
      customTransport: wire, redEnabled: true, redundancyLevel: 2, timestampIncrement: 100,
    });
    t.sendText('xyz');
    jest.advanceTimersByTime(SEND_INTERVAL_MS * 5);
    expect(wire.sent).toHaveLength(3);
    const last = wire.sent[2];
    expect(last.readUInt32BE(12) & 0x3ff).toBe(3); // 'xyz' as the oldest redundant block
    expect(last.readUInt32BE(16) & 0x3ff).toBe(0); // then an empty block
    expect(last.length).toBe(12 + 8 + 1 + 3);      // and an empty primary
    t.close();
    jest.useRealTimers();
  });
});

describe('generic FEC packets (RFC 5109 §7)', () => {
  it('uses its own sequence space and the 10 + 4 byte header layout', () => {
    const wire = capture();
    const t = new T140RtpTransport('127.0.0.1', 5004, {
      customTransport: wire, fecEnabled: true, fecGroupSize: 2, ssrc: 7, timestampIncrement: 10, redEnabled: false,
    });
    t.sendText('hi', { markerBit: true });
    t.sendText('yo!');
    t.sendText('third');

    expect(wire.sent).toHaveLength(4);
    const fec = wire.sent[2];
    expect(fec[1] & 0x80).toBe(0);                 // marker SHALL be 0
    expect(fec[1] & 0x7f).toBe(97);
    expect(fec.readUInt16BE(2)).toBe(0);           // first FEC packet
    expect(fec.readUInt32BE(8)).toBe(7);           // same SSRC as the media
    expect(fec[12]).toBe(0);                       // E, L, P, X, CC recovery
    expect(fec[13]).toBe(0x80);                    // M recovery = 1 ^ 0, PT recovery = 96 ^ 96
    expect(fec.readUInt16BE(14)).toBe(0);          // SN base
    expect(fec.readUInt32BE(16)).toBe(0 ^ 10);     // TS recovery
    expect(fec.readUInt16BE(20)).toBe(2 ^ 3);      // length recovery
    expect(fec.readUInt16BE(22)).toBe(3);          // protection length
    expect(fec.readUInt16BE(24)).toBe(0xc000);     // mask, MSB = SN base
    expect(fec.subarray(26)).toEqual(Buffer.from([0x68 ^ 0x79, 0x69 ^ 0x6f, 0x00 ^ 0x21]));
    expect(wire.sent[3].readUInt16BE(2)).toBe(2);  // media sequence continues without a gap
    t.close();
  });
});

describe('RTP timestamps (RFC 4103 §3)', () => {
  it('run at 1000 Hz wall clock and never repeat', () => {
    jest.useFakeTimers();
    const wire = capture();
    const t = new T140RtpTransport('127.0.0.1', 5004, { customTransport: wire, redEnabled: false });
    t.sendText('a');
    jest.advanceTimersByTime(50);
    t.sendText('b');
    t.sendText('c');
    const ts = wire.sent.map((p) => p.readUInt32BE(4));
    expect(ts[1] - ts[0]).toBe(50);
    expect(ts[2] - ts[1]).toBe(1);
    t.close();
    jest.useRealTimers();
  });
});

describe('transport safety', () => {
  it('refuses to send plaintext after a failed SRTP setup', () => {
    const wire = capture();
    const t = new T140RtpTransport('127.0.0.1', 5004, { customTransport: wire, redEnabled: false });
    const errors: unknown[] = [];
    t.on('error', (e) => errors.push(e));
    expect(() => t.setupSrtp({ masterKey: Buffer.alloc(3), masterSalt: Buffer.alloc(14) })).toThrow();
    t.sendText('secret');
    expect(wire.sent).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('ignores sendText after close and tolerates a second close', () => {
    const wire = capture();
    const t = new T140RtpTransport('127.0.0.1', 5004, { customTransport: wire, redEnabled: false });
    t.close();
    t.close();
    t.sendText('late');
    expect(wire.sent).toHaveLength(0);
  });

  it('rejects out-of-range config and more than 15 CSRCs', () => {
    expect(() => new T140RtpTransport('127.0.0.1', 0)).toThrow();
    expect(() => new T140RtpTransport('127.0.0.1', 5004, { payloadType: 200 })).toThrow();
    expect(() => new T140RtpTransport('127.0.0.1', 5004, { fecGroupSize: 17 })).toThrow();
    expect(() => createRtpPacket(0, 0, 'x', { csrcList: new Array(16).fill(1) })).toThrow();
  });
});

describe('stream pipeline', () => {
  it('does not re-send the text when processBackspaces is on and the stream ends', () => {
    const stream = new EventEmitter();
    const sentTexts: string[] = [];
    attachStreamProcessor(stream, resolveStreamOptions({ processBackspaces: true }), {
      sendText: (t) => sentTexts.push(t),
      close: () => undefined,
    });
    stream.emit('data', 'Hel');
    stream.emit('data', 'lo');
    stream.emit('end');
    expect(sentTexts).toEqual(['Hel', 'lo']);
  });

  it('detaches without removing the caller\'s own listeners', () => {
    const stream = new EventEmitter();
    const mine = jest.fn();
    stream.on('data', mine);
    const detach = attachStreamProcessor(stream, resolveStreamOptions({}), {
      sendText: () => undefined,
      close: () => undefined,
    });
    detach();
    stream.emit('data', 'x');
    expect(mine).toHaveBeenCalledTimes(1);
    expect(stream.listenerCount('data')).toBe(1);
  });

  it('yields no text for SDK event objects without a text field', () => {
    expect(extractTextFromChunk({ type: 'message_start', message: {} }).text).toBe('');
    expect(extractTextFromChunk({ choices: [{ delta: { content: null, tool_calls: [] } }] }).text).toBe('');
    expect(extractTextFromChunk(Buffer.from('raw')).text).toBe('raw');
  });
});

describe('multiplexer', () => {
  it('honors processBackspaces and removes an ended stream once its queue drained', () => {
    const wire = capture();
    const mux = new T140RtpMultiplexer('127.0.0.1', 5004, {
      customTransport: wire, processBackspaces: true, useCsrcForStreamId: true,
    });
    const stream = new EventEmitter();
    mux.addStream('s', stream);
    stream.emit('data', '\b\bab');     // nothing to erase yet, so the backspaces are dropped
    stream.emit('end');
    expect(wire.sent).toHaveLength(1);
    expect(extractT140Text(wire.sent[0])).toBe('ab');
    expect(mux.getStreamCount()).toBe(0);
    mux.close();
  });
});

describe('demultiplexer', () => {
  it('skips a header extension and trailing padding (RFC 3550 §5.1)', () => {
    const demux = new T140StreamDemultiplexer();
    const texts: string[] = [];
    demux.on('data', (d) => texts.push(d.text));
    const header = Buffer.alloc(12);
    header[0] = 0x80 | 0x10 | 0x20;   // V=2, X=1, P=1
    const extension = Buffer.from([0xbe, 0xde, 0x00, 0x01, 1, 2, 3, 4]);
    const padding = Buffer.from([0, 0, 3]);
    demux.processPacket(Buffer.concat([header, extension, Buffer.from('hi'), padding]));
    expect(texts).toEqual(['hi']);
  });
});

describe('RED defaults and parsing (RFC 4103 §4)', () => {
  it('defaults to text/red with no redundant blocks in the first packet when no redEnabled is given', () => {
    const wire = capture();
    const t2 = new T140RtpTransport('127.0.0.1', 5004, { customTransport: wire });
    t2.sendText('hello');
    const parsed = parseT140RedPacket(wire.sent[0]);
    expect(parsed.payloadType).toBe(98);
    expect(parsed.redundant).toHaveLength(0);
    expect(parsed.primary).toBe('hello');
    t2.close();
  });

  it('extractT140Text returns the same text for RED and plain packets', () => {
    const red = capture();
    const plain = capture();
    const a = new T140RtpTransport('127.0.0.1', 5004, { customTransport: red });
    const b = new T140RtpTransport('127.0.0.1', 5004, { customTransport: plain, redEnabled: false });
    a.sendText('same');
    b.sendText('same');
    expect(extractT140Text(red.sent[0])).toBe('same');
    expect(extractT140Text(plain.sent[0])).toBe('same');
    a.close();
    b.close();
  });

  it('parseT140RedPacket throws on a truncated packet', () => {
    const wire = capture();
    const t = new T140RtpTransport('127.0.0.1', 5004, { customTransport: wire, redundancyLevel: 2 });
    t.sendText('a');
    t.sendText('bb');
    expect(() => parseT140RedPacket(wire.sent[1].subarray(0, 14))).toThrow();
    t.close();
  });
});
