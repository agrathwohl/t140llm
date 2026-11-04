import { EventEmitter } from 'events';

// Steganography is powered by @agrathwohl/llm-steg, an optional dependency
// published to GitHub Packages. Skip this suite when it is not installed:
//   npm config set @agrathwohl:registry https://npm.pkg.github.com
//   NODE_AUTH_TOKEN=<token with read:packages> npm install @agrathwohl/llm-steg
let llmStegAvailable = true;
try {
  require('@agrathwohl/llm-steg');
} catch (_err) {
  llmStegAvailable = false;
  // eslint-disable-next-line no-console
  console.warn('Skipping steganography tests: @agrathwohl/llm-steg is not installed');
}
const describeSteg = llmStegAvailable ? describe : describe.skip;

// describe.skip still evaluates its body, so load the module only when present.
/* eslint-disable @typescript-eslint/no-var-requires */
let StegTransport: any;
let createStegT140RtpTransport: any;
let processAIStreamToStegRtp: any;
let T140RtpTransport: any;
if (llmStegAvailable) {
  ({ StegTransport } = require('../src/steganography/steg-transport'));
  ({ createStegT140RtpTransport, processAIStreamToStegRtp } =
    require('../src/steganography/transport-factory'));
  ({ T140RtpTransport } = require('../src/rtp/t140-rtp-transport'));
}
/* eslint-enable @typescript-eslint/no-var-requires */

jest.mock('dgram', () => ({
  createSocket: jest.fn().mockImplementation(() => ({
    send: jest.fn((data, offset, length, port, address, callback) => {
      if (callback) callback();
    }),
    close: jest.fn(),
    on: jest.fn(),
  })),
}));

describeSteg('Steganography', () => {
  const mockTransport = {
    send: jest.fn((data, callback) => {
      if (callback) callback();
    }),
    close: jest.fn(),
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('StegTransport', () => {
    it('enables steganography and the LSB algorithm by default', () => {
      const stegTransport = new StegTransport(mockTransport, {});
      expect(stegTransport.getConfig().enabled).toBe(true);
      expect(stegTransport.getConfig().algorithm).toBe('lsb');
      expect(stegTransport.getConfig().seed).toHaveLength(32);
    });

    it('passes data through untouched when disabled', () => {
      const stegTransport = new StegTransport(mockTransport, { enabled: false });
      const data = Buffer.from('test data');

      stegTransport.send(data, () => undefined);

      expect(mockTransport.send).toHaveBeenCalledWith(data, expect.any(Function));
    });

    it('passes data through when there is no cover media', () => {
      const stegTransport = new StegTransport(mockTransport, { enabled: true, coverMedia: [] });
      const data = Buffer.from('test data');

      stegTransport.send(data, () => undefined);

      expect(mockTransport.send).toHaveBeenCalledWith(data, expect.any(Function));
    });

    it('hides the packet in the cover and recovers it', () => {
      const coverMedia = [Buffer.alloc(1024, 0xff)];
      const stegTransport = new StegTransport(mockTransport, { enabled: true, coverMedia });

      const data = Buffer.from('test');
      stegTransport.send(data, () => undefined);

      expect(mockTransport.send).toHaveBeenCalled();
      const sentData = mockTransport.send.mock.calls[0][0];
      expect(sentData).not.toEqual(data);
      expect(sentData).toHaveLength(coverMedia[0].length);
      expect(stegTransport.decode(sentData).toString()).toBe('test');
    });

    it('encodes into a caller-supplied cover buffer', () => {
      const stegTransport = new StegTransport(mockTransport, { enabled: true });
      const cover = Buffer.alloc(1024, 0xaa);

      const encoded = stegTransport.encode(Buffer.from('explicit cover'), cover);

      expect(encoded).not.toEqual(cover);
      expect(stegTransport.decode(encoded).toString()).toBe('explicit cover');
    });

    it('updates the configuration', () => {
      const stegTransport = new StegTransport(mockTransport, { enabled: true });

      stegTransport.updateConfig({ enabled: false });

      expect(stegTransport.getConfig().enabled).toBe(false);
    });

    it('reports an error instead of sending raw data when the cover is too small', () => {
      const stegTransport = new StegTransport(mockTransport, {
        enabled: true,
        coverMedia: [Buffer.alloc(200)],
      });
      const callback = jest.fn();

      stegTransport.send(Buffer.alloc(1000, 'X'), callback);

      expect(callback).toHaveBeenCalledWith(expect.any(Error));
      expect(callback.mock.calls[0][0].message).toMatch(/too large|capacity/i);
      expect(mockTransport.send).not.toHaveBeenCalled();
    });

    it('sends the packet unhidden when onError is passthrough', () => {
      const stegTransport = new StegTransport(mockTransport, {
        enabled: true,
        onError: 'passthrough',
        coverMedia: [Buffer.alloc(200)],
      });
      const data = Buffer.alloc(1000, 'X');

      stegTransport.send(data, () => undefined);

      expect(mockTransport.send).toHaveBeenCalled();
      expect(mockTransport.send.mock.calls[0][0]).toEqual(data);
    });

    it('rejects the removed LLM encode mode', () => {
      expect(() => new StegTransport(mockTransport, { encodeMode: 'llm' } as never)).toThrow(
        /LLM encode mode was removed/
      );
    });

    it('closes the inner transport', () => {
      const stegTransport = new StegTransport(mockTransport, { enabled: true });
      stegTransport.close();
      expect(mockTransport.close).toHaveBeenCalled();
    });
  });

  describe('factory functions', () => {
    it('creates an RTP transport that encodes its packets', () => {
      const sent: Buffer[] = [];
      const transport = createStegT140RtpTransport('127.0.0.1', 5004, {
        redEnabled: false,
        customTransport: {
          send: (data: Buffer, cb?: (e?: Error) => void) => {
            sent.push(Buffer.from(data));
            cb?.();
          },
          close: () => undefined,
        },
        steganography: { enabled: true, coverMedia: [Buffer.alloc(4096, 0xff)] },
      });

      expect(transport).toBeInstanceOf(T140RtpTransport);
      transport.sendText('hidden');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toHaveLength(4096);
      transport.close();
    });

    it('processes an AI stream through a steganographic transport', () => {
      const stream = new EventEmitter();
      const transport = processAIStreamToStegRtp(stream, '127.0.0.1', 5004, {
        steganography: { enabled: true, coverMedia: [Buffer.alloc(4096, 0xff)] },
      });

      expect(transport).toBeInstanceOf(T140RtpTransport);
      stream.emit('data', 'hi');
      stream.emit('end');
      transport.close();
    });
  });
});
