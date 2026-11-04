import { EventEmitter } from 'events';
import { createSrtpKeysFromPassphrase } from '../src/utils/security';
import { processAIStreamToSrtp } from '../src/processors/process-ai-stream-to-srtp';
import { T140RtpTransport } from '../src/rtp/t140-rtp-transport';

const customTransport = () => ({ send: jest.fn(), close: jest.fn() });

describe('SRTP Functionality', () => {
  describe('createSrtpKeysFromPassphrase', () => {
    test('generates a 16-byte key and 14-byte salt', () => {
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('test-passphrase');

      expect(Buffer.isBuffer(masterKey)).toBe(true);
      expect(Buffer.isBuffer(masterSalt)).toBe(true);
      expect(masterKey.length).toBe(16);
      expect(masterSalt.length).toBe(14);
    });

    test('reproduces the same keys when given the returned salt', () => {
      const first = createSrtpKeysFromPassphrase('test-passphrase');
      const second = createSrtpKeysFromPassphrase('test-passphrase', first.salt);

      expect(second.masterKey.equals(first.masterKey)).toBe(true);
      expect(second.masterSalt.equals(first.masterSalt)).toBe(true);
    });

    test('generates different keys on each call without a salt', () => {
      const first = createSrtpKeysFromPassphrase('test-passphrase');
      const second = createSrtpKeysFromPassphrase('test-passphrase');

      expect(first.masterKey.equals(second.masterKey)).toBe(false);
    });

    test('generates different keys for different passphrases with the same salt', () => {
      const salt = Buffer.alloc(32, 1);
      const one = createSrtpKeysFromPassphrase('passphrase-one', salt);
      const two = createSrtpKeysFromPassphrase('passphrase-two', salt);

      expect(one.masterKey.equals(two.masterKey)).toBe(false);
      expect(one.masterSalt.equals(two.masterSalt)).toBe(false);
    });

    test('handles empty passphrase', () => {
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('');

      expect(masterKey.length).toBe(16);
      expect(masterSalt.length).toBe(14);
    });

    test('rejects a salt shorter than 16 bytes', () => {
      expect(() => createSrtpKeysFromPassphrase('pw', Buffer.alloc(8)))
        .toThrow('Salt must be at least 16 bytes');
    });

    test('produces keys accepted by setupSrtp', () => {
      const transport = new T140RtpTransport('127.0.0.1', 5004, { customTransport: customTransport() });
      expect(() => transport.setupSrtp(createSrtpKeysFromPassphrase('pw'))).not.toThrow();
    });
  });

  describe('SrtpConfig Validation', () => {
    let stream: EventEmitter;

    beforeEach(() => {
      stream = new EventEmitter();
    });

    test('should throw error when srtpConfig is missing masterKey', () => {
      const invalidConfig = { masterSalt: Buffer.alloc(14, 0xbb) } as any;
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig))
        .toThrow('SRTP configuration requires masterKey');
    });

    test('should throw error when srtpConfig is missing masterSalt', () => {
      const invalidConfig = { masterKey: Buffer.alloc(16, 0xaa) } as any;
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig))
        .toThrow('SRTP configuration requires masterSalt');
    });

    test('should throw error when masterKey is not a Buffer', () => {
      const invalidConfig = { masterKey: 'not-a-buffer', masterSalt: Buffer.alloc(14, 0xbb) } as any;
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig))
        .toThrow('SRTP masterKey must be a Buffer');
    });

    test('should throw error when masterSalt is not a Buffer', () => {
      const invalidConfig = { masterKey: Buffer.alloc(16, 0xaa), masterSalt: 'not-a-buffer' } as any;
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig))
        .toThrow('SRTP masterSalt must be a Buffer');
    });

    test('should throw error when masterKey is empty Buffer', () => {
      const invalidConfig = { masterKey: Buffer.alloc(0), masterSalt: Buffer.alloc(14, 0xbb) };
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig))
        .toThrow('SRTP masterKey cannot be empty');
    });

    test('should throw error when masterSalt is empty Buffer', () => {
      const invalidConfig = { masterKey: Buffer.alloc(16, 0xaa), masterSalt: Buffer.alloc(0) };
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig))
        .toThrow('SRTP masterSalt cannot be empty');
    });

    test('should throw error when srtpConfig is null', () => {
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, null as any))
        .toThrow('SRTP configuration is required');
    });

    test('should throw error when srtpConfig is undefined', () => {
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, undefined as any))
        .toThrow('SRTP configuration is required');
    });

    test('should throw error when masterKey is not 16 bytes', () => {
      const config = { masterKey: Buffer.alloc(8, 0xaa), masterSalt: Buffer.alloc(14, 0xbb), customTransport: customTransport() };
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, config))
        .toThrow('SRTP masterKey must be 16 bytes');
    });

    test('should accept valid srtpConfig with proper masterKey and masterSalt', () => {
      const config = { masterKey: Buffer.alloc(16, 0xaa), masterSalt: Buffer.alloc(14, 0xbb), customTransport: customTransport() };
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, config)).not.toThrow();
    });

    test('should accept srtpConfig generated from createSrtpKeysFromPassphrase', () => {
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('test-passphrase');
      expect(() => processAIStreamToSrtp(stream, '127.0.0.1', 5006, { masterKey, masterSalt, customTransport: customTransport() }))
        .not.toThrow();
    });
  });
});
