import { T140RtpError, T140RtpErrorType } from '../interfaces';

/**
 * Factory for creating standardized T140RtpError objects
 * Reduces code duplication and ensures consistent error formatting
 */
export class ErrorFactory {
  /**
   * Create a network error
   */
  static NETWORK(message: string, cause?: Error): T140RtpError {
    return {
      cause,
      message,
      type: T140RtpErrorType.NETWORK_ERROR,
    };
  }

  /**
   * Create an encryption error
   */
  static ENCRYPTION(message: string, cause?: Error): T140RtpError {
    return {
      cause,
      message,
      type: T140RtpErrorType.ENCRYPTION_ERROR,
    };
  }

  /**
   * Create a FEC error
   */
  static FEC(message: string, cause?: Error): T140RtpError {
    return {
      cause,
      message,
      type: T140RtpErrorType.FEC_ERROR,
    };
  }

  /**
   * Create an invalid configuration error
   */
  static INVALID_CONFIG(message: string, cause?: Error): T140RtpError {
    return {
      cause,
      message,
      type: T140RtpErrorType.INVALID_CONFIG,
    };
  }

  /**
   * Create a rate limit error
   */
  static RATE_LIMIT(message: string, cause?: Error): T140RtpError {
    return {
      cause,
      message,
      type: T140RtpErrorType.RATE_LIMIT_ERROR,
    };
  }

  /**
   * Create a resource error
   */
  static RESOURCE(message: string, cause?: Error): T140RtpError {
    return {
      cause,
      message,
      type: T140RtpErrorType.RESOURCE_ERROR,
    };
  }
}
