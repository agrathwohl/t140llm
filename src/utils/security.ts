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

  // Use PBKDF2 to derive key material
  // Total derived size includes both key and salt per RFC 3711
  const derivedKeyMaterial = crypto.pbkdf2Sync(
    passphrase,
    fixedSalt,
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

  return { masterKey, masterSalt };
}
