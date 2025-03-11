/**
 * Error types for T140RtpTransport
 */
export enum T140RtpErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',       // UDP socket or network-related errors
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR', // SRTP encryption errors
  FEC_ERROR = 'FEC_ERROR',               // Forward Error Correction errors
  INVALID_CONFIG = 'INVALID_CONFIG',     // Invalid configuration errors
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR', // Rate limiting errors
  RESOURCE_ERROR = 'RESOURCE_ERROR',     // Resource allocation/deallocation errors
}

/**
 * Interface for T140RtpTransport Error objects
 */
export interface T140RtpError {
  type: T140RtpErrorType;
  message: string;
  cause?: Error;
}
