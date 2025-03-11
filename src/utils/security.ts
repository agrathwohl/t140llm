import * as crypto from 'crypto';

/**
 * Generate a cryptographically secure random SSRC value
 * SSRC is a 32-bit unsigned integer (0 to 4,294,967,295)
 */
export function generateSecureSSRC(): number {
  // Generate 4 random bytes and convert to a 32-bit unsigned integer
  const randomBytes = crypto.randomBytes(4);
  return randomBytes.readUInt32BE(0);
}

/**
 * Helper function to create SRTP key and salt from a passphrase
 * Uses PBKDF2 for secure key derivation
 */
export function createSrtpKeysFromPassphrase(passphrase: string): {
  masterKey: Buffer;
  masterSalt: Buffer;
} {
  // Use a fixed salt for PBKDF2
  // This is a constant salt - in a production environment, consider using a per-user salt
  // that is securely stored and associated with each user
  const fixedSalt = Buffer.from('T140RtpTransportSaltValue', 'utf8');

  // Use PBKDF2 to derive key material (10000 iterations is a reasonable minimum)
  // Total 30 bytes for both key (16 bytes) and salt (14 bytes)
  const derivedKeyMaterial = crypto.pbkdf2Sync(
    passphrase,
    fixedSalt,
    10000,
    30,
    'sha256'
  );

  // Split the derived key material into master key and master salt
  const masterKey = derivedKeyMaterial.slice(0, 16);    // First 16 bytes (128 bits) for master key
  const masterSalt = derivedKeyMaterial.slice(16, 30);  // Next 14 bytes (112 bits) for master salt

  return { masterKey, masterSalt };
}
