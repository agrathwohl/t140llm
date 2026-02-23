import { createSrtpKeysFromPassphrase, processAIStreamToSrtp } from '../src';
import { EventEmitter } from 'events';

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

describe('SRTP Functionality', () => {
  describe('createSrtpKeysFromPassphrase', () => {
    test('generates consistent key and salt from a passphrase', () => {
      const passphrase = 'test-passphrase';
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase(passphrase);
      
      // Check that we got buffers of the expected lengths
      expect(Buffer.isBuffer(masterKey)).toBe(true);
      expect(Buffer.isBuffer(masterSalt)).toBe(true);
      expect(masterKey.length).toBe(16); // 128 bits
      expect(masterSalt.length).toBe(14); // 112 bits
      
      // Generate again with the same passphrase and ensure we get the same result
      const { masterKey: key2, masterSalt: salt2 } = createSrtpKeysFromPassphrase(passphrase);
      expect(masterKey.equals(key2)).toBe(true);
      expect(masterSalt.equals(salt2)).toBe(true);
    });
    
    test('generates different keys for different passphrases', () => {
      const passphrase1 = 'passphrase-one';
      const passphrase2 = 'passphrase-two';
      
      const result1 = createSrtpKeysFromPassphrase(passphrase1);
      const result2 = createSrtpKeysFromPassphrase(passphrase2);
      
      // Keys and salts should be different
      expect(result1.masterKey.equals(result2.masterKey)).toBe(false);
      expect(result1.masterSalt.equals(result2.masterSalt)).toBe(false);
    });
    
    test('handles empty passphrase', () => {
      const passphrase = '';
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase(passphrase);
      
      // Should still produce buffers of the right length
      expect(masterKey.length).toBe(16);
      expect(masterSalt.length).toBe(14);
      
      // Both should be filled with zeros (since empty buffer is cycled)
      expect(masterKey.every(byte => byte === 0)).toBe(true);
      expect(masterSalt.every(byte => byte === 0)).toBe(true);
    });
    
    test('handles long passphrases', () => {
      const longPassphrase = 'this-is-a-very-long-passphrase-that-exceeds-the-length-of-both-the-master-key-and-salt-combined';
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase(longPassphrase);
      
      // Should truncate appropriately
      expect(masterKey.length).toBe(16);
      expect(masterSalt.length).toBe(14);
      
      // First 16 bytes should match the passphrase
      const passphraseBuffer = Buffer.from(longPassphrase);
      for (let i = 0; i < 16; i++) {
        expect(masterKey[i]).toBe(passphraseBuffer[i]);
      }
      
      // Next 14 bytes (salt) should match the next part of the passphrase
      for (let i = 0; i < 14; i++) {
        expect(masterSalt[i]).toBe(passphraseBuffer[i + 16]);
      }
    });
  });

  describe('SrtpConfig Validation', () => {
    let stream: MockDataStream;

    beforeEach(() => {
      stream = new MockDataStream();
    });

    test('should throw error when srtpConfig is missing masterKey', () => {
      const invalidConfig = {
        masterSalt: Buffer.alloc(14, 0xbb),
      } as any;

      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig);
      }).toThrow('SRTP configuration requires masterKey');
    });

    test('should throw error when srtpConfig is missing masterSalt', () => {
      const invalidConfig = {
        masterKey: Buffer.alloc(16, 0xaa),
      } as any;

      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig);
      }).toThrow('SRTP configuration requires masterSalt');
    });

    test('should throw error when masterKey is not a Buffer', () => {
      const invalidConfig = {
        masterKey: 'not-a-buffer',
        masterSalt: Buffer.alloc(14, 0xbb),
      } as any;

      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig);
      }).toThrow('SRTP masterKey must be a Buffer');
    });

    test('should throw error when masterSalt is not a Buffer', () => {
      const invalidConfig = {
        masterKey: Buffer.alloc(16, 0xaa),
        masterSalt: 'not-a-buffer',
      } as any;

      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig);
      }).toThrow('SRTP masterSalt must be a Buffer');
    });

    test('should throw error when masterKey is empty Buffer', () => {
      const invalidConfig = {
        masterKey: Buffer.alloc(0),
        masterSalt: Buffer.alloc(14, 0xbb),
      } as any;

      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig);
      }).toThrow('SRTP masterKey cannot be empty');
    });

    test('should throw error when masterSalt is empty Buffer', () => {
      const invalidConfig = {
        masterKey: Buffer.alloc(16, 0xaa),
        masterSalt: Buffer.alloc(0),
      } as any;

      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, invalidConfig);
      }).toThrow('SRTP masterSalt cannot be empty');
    });

    test('should throw error when srtpConfig is null', () => {
      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, null as any);
      }).toThrow('SRTP configuration is required');
    });

    test('should throw error when srtpConfig is undefined', () => {
      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, undefined as any);
      }).toThrow('SRTP configuration is required');
    });

    test('should accept valid srtpConfig with proper masterKey and masterSalt', () => {
      const validConfig = {
        masterKey: Buffer.alloc(16, 0xaa),
        masterSalt: Buffer.alloc(14, 0xbb),
      };

      // Should not throw
      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, validConfig);
      }).not.toThrow();
    });

    test('should accept srtpConfig generated from createSrtpKeysFromPassphrase', () => {
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('test-passphrase');
      const validConfig = { masterKey, masterSalt };

      // Should not throw
      expect(() => {
        processAIStreamToSrtp(stream, '127.0.0.1', 5006, validConfig);
      }).not.toThrow();
    });
  });
});