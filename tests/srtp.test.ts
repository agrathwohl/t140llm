import { createSrtpKeysFromPassphrase } from '../src';

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
});