import { ProcessorOptions, SrtpConfig, TextDataStream } from '../interfaces';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { DEFAULT_SRTP_PORT } from '../utils/constants';
import { attachStreamToRtpTransport } from './process-ai-stream-to-rtp';

/**
 * Throws unless masterKey and masterSalt are non-empty Buffers.
 */
function validateSrtpConfig(srtpConfig: SrtpConfig): void {
  if (!srtpConfig) {
    throw new Error('SRTP configuration is required');
  }
  for (const field of ['masterKey', 'masterSalt'] as const) {
    const value = srtpConfig[field];
    if (!value) {
      throw new Error(`SRTP configuration requires ${field}`);
    }
    if (!Buffer.isBuffer(value)) {
      throw new Error(`SRTP ${field} must be a Buffer`);
    }
    if (value.length === 0) {
      throw new Error(`SRTP ${field} cannot be empty`);
    }
  }
}

/**
 * Attach a stream to an existing T140 SRTP transport. Same pacing and M-bit
 * rules as attachStreamToRtpTransport; only the transport differs.
 *
 * @param transport The transport to attach the stream to
 * @param stream The stream to attach
 * @param srtpConfig SRTP configuration options
 * @param processorOptions Processor options; override the matching srtpConfig fields
 */
export function attachStreamToSrtpTransport(
  transport: T140RtpTransport,
  stream: TextDataStream,
  srtpConfig: SrtpConfig,
  processorOptions: ProcessorOptions = {}
): void {
  attachStreamToRtpTransport(transport, stream, srtpConfig, processorOptions);
}

/**
 * Create a T140 SRTP transport that streams can be attached to later.
 *
 * @param remoteAddress Remote address to send packets to
 * @param remotePort Remote port to send packets to
 * @param srtpConfig SRTP configuration including keys
 * @returns The transport and a function to attach a stream to it
 */
export function createT140SrtpTransport(
  remoteAddress: string,
  remotePort: number = DEFAULT_SRTP_PORT,
  srtpConfig: SrtpConfig
): {
  transport: T140RtpTransport;
  attachStream: (
    stream: TextDataStream,
    processorOptions?: ProcessorOptions
  ) => void;
} {
  validateSrtpConfig(srtpConfig);

  const transport = new T140RtpTransport(remoteAddress, remotePort, srtpConfig);
  transport.setupSrtp(srtpConfig);

  if (srtpConfig.bomPrewarm) {
    transport.sendText('﻿', { markerBit: true });
  }

  return {
    transport,
    attachStream: (stream, processorOptions = {}) => {
      attachStreamToSrtpTransport(transport, stream, srtpConfig, processorOptions);
    },
  };
}

/**
 * Stream an LLM response as T.140 over SRTP.
 *
 * @param stream The AI stream to process
 * @param remoteAddress Remote address to send packets to
 * @param remotePort Remote port to send packets to (default 5006)
 * @param srtpConfig SRTP configuration including custom transport if needed
 * @param existingTransport Optional existing T140RtpTransport to use
 * @returns T140RtpTransport instance
 */
export function processAIStreamToSrtp(
  stream: TextDataStream,
  remoteAddress: string,
  remotePort: number = DEFAULT_SRTP_PORT,
  srtpConfig: SrtpConfig,
  existingTransport?: T140RtpTransport
): T140RtpTransport {
  validateSrtpConfig(srtpConfig);

  if (existingTransport) {
    existingTransport.setupSrtp(srtpConfig);
    attachStreamToSrtpTransport(existingTransport, stream, srtpConfig);
    return existingTransport;
  }

  const { transport, attachStream } = createT140SrtpTransport(
    remoteAddress, remotePort, srtpConfig
  );
  attachStream(stream);
  return transport;
}
