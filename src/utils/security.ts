import * as crypto from 'crypto';
import {
  PBKDF2_ITERATIONS,
  PBKDF2_TOTAL_DERIVED_SIZE,
  SRTP_MASTER_KEY_SIZE,
} from './constants';

// Size of SSRC in bytes (32-bit = 4 bytes)
const SSRC_SIZE_BYTES = 4;
// Offset for reading SSRC from buffer
const SSRC_BUFFER_OFFSET = 0;

/**
 * Generate a cryptographically secure random SSRC value
 * SSRC is a 32-bit unsigned integer (0 to 4,294,967,295)
 */
export function generateSecureSSRC(): number {
  // Generate random bytes and convert to a 32-bit unsigned integer
  const randomBytes = crypto.randomBytes(SSRC_SIZE_BYTES);
  return randomBytes.readUInt32BE(SSRC_BUFFER_OFFSET);
}

// Size of random salt for PBKDF2 in bytes (minimum 16 bytes recommended)
const PBKDF2_SALT_SIZE = 32;

/**
 * Helper function to create SRTP key and salt from a passphrase
 * Uses PBKDF2 with random salt for secure key derivation
 *
 * SECURITY NOTE: The salt must be stored alongside the encrypted data
 * and provided during decryption. Without the salt, the key cannot be
 * reproduced from the passphrase.
 */
export function createSrtpKeysFromPassphrase(
  passphrase: string,
  providedSalt?: Buffer
): {
  masterKey: Buffer;
  masterSalt: Buffer;
  salt: Buffer;
} {
  // Generate a cryptographically secure random salt if not provided
  // Using a random salt ensures that the same passphrase produces different keys
  // each time, preventing rainbow table attacks
  const salt = providedSalt ?? crypto.randomBytes(PBKDF2_SALT_SIZE);

  // Validate salt length
  if (salt.length < 16) {
    throw new Error('Salt must be at least 16 bytes for security');
  }

  // Use PBKDF2 to derive key material
  // Total derived size includes both key and salt per RFC 3711
  const derivedKeyMaterial = crypto.pbkdf2Sync(
    passphrase,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_TOTAL_DERIVED_SIZE,
    'sha256'
  );

  // Split the derived key material into master key and master salt per RFC 3711
  const masterKey = derivedKeyMaterial.slice(0, SRTP_MASTER_KEY_SIZE);    // 128 bits for master key
  const masterSalt = derivedKeyMaterial.slice(
    SRTP_MASTER_KEY_SIZE,
    PBKDF2_TOTAL_DERIVED_SIZE
  );  // 112 bits for master salt

  return { masterKey, masterSalt, salt };
}
