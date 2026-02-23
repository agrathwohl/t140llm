import { ProcessorOptions, SrtpConfig, TextDataStream } from '../interfaces';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { DEFAULT_SRTP_PORT } from '../utils/constants';
import {
  attachStreamProcessor,
  resolveStreamOptions,
} from '../utils/stream-processor';

/**
 * Validates that required SRTP configuration fields are present
 * Throws an error if masterKey or masterSalt is missing or invalid
 *
 * @param srtpConfig The SRTP configuration to validate
 * @throws Error if required fields are missing or invalid
 */
function validateSrtpConfig(srtpConfig: SrtpConfig): void {
  if (!srtpConfig) {
    throw new Error('SRTP configuration is required');
  }

  if (!srtpConfig.masterKey) {
    throw new Error('SRTP configuration requires masterKey');
  }

  if (!Buffer.isBuffer(srtpConfig.masterKey)) {
    throw new Error('SRTP masterKey must be a Buffer');
  }

  if (srtpConfig.masterKey.length === 0) {
    throw new Error('SRTP masterKey cannot be empty');
  }

  if (!srtpConfig.masterSalt) {
    throw new Error('SRTP configuration requires masterSalt');
  }

  if (!Buffer.isBuffer(srtpConfig.masterSalt)) {
    throw new Error('SRTP masterSalt must be a Buffer');
  }

  if (srtpConfig.masterSalt.length === 0) {
    throw new Error('SRTP masterSalt cannot be empty');
  }
}

/**
 * Attach a stream to an existing T140 SRTP transport
 *
 * @param transport The transport to attach the stream to
 * @param stream The stream to attach
 * @param srtpConfig SRTP configuration options
 * @param processorOptions Processor options for handling the stream
 */
export function attachStreamToSrtpTransport(
  transport: T140RtpTransport,
  stream: TextDataStream,
  srtpConfig: SrtpConfig,
  processorOptions: ProcessorOptions = {}
): void {
  const options = resolveStreamOptions(processorOptions, {
    processBackspaces: srtpConfig.processBackspaces,
    handleMetadata: srtpConfig.handleMetadata,
    metadataCallback: srtpConfig.metadataCallback,
  });

  attachStreamProcessor(stream, options, {
    sendText: (text) => transport.sendText(text),
    close: () => transport.close(),
  });
}

/**
 * Create a T140 SRTP transport that can be used to send T.140 data securely
 *
 * @param remoteAddress Remote address to send packets to
 * @param remotePort Remote port to send packets to
 * @param srtpConfig SRTP configuration including secure options
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

  const attachStream = (
    stream: TextDataStream,
    processorOptions: ProcessorOptions = {}
  ) => {
    attachStreamToSrtpTransport(transport, stream, srtpConfig, processorOptions);
  };

  return { transport, attachStream };
}

/**
 * Process an AI stream and send chunks directly as T.140 over SRTP
 *
 * @param stream The AI stream to process
 * @param remoteAddress Remote address to send packets to
 * @param remotePort Remote port to send packets to (defaults to DEFAULT_SRTP_PORT)
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

  const processorOptions: ProcessorOptions = {
    processBackspaces: srtpConfig.processBackspaces,
    handleMetadata: srtpConfig.handleMetadata,
    metadataCallback: srtpConfig.metadataCallback,
  };

  if (existingTransport) {
    existingTransport.setupSrtp(srtpConfig);
    attachStreamToSrtpTransport(existingTransport, stream, srtpConfig, processorOptions);
    return existingTransport;
  }

  const { transport, attachStream } = createT140SrtpTransport(
    remoteAddress, remotePort, srtpConfig
  );
  attachStream(stream, processorOptions);
  return transport;
}
