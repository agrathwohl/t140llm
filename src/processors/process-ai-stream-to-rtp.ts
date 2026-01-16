import { ProcessorOptions, RtpConfig, TextDataStream } from '../interfaces';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { processT140BackspaceChars, toGraphemes } from '../utils/backspace-processing';
import {
  DEFAULT_CHAR_RATE_LIMIT,
  DEFAULT_RTP_PORT,
  MIN_TOKEN_BUCKET_VALUE,
  SEND_INTERVAL_MS,
  TOKEN_REFILL_RATE_DIVISOR,
} from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';

/**
 * Attach a stream to an existing T140 RTP transport with rate limiting
 *
 * @param transport The transport to attach the stream to
 * @param stream The stream to attach
 * @param rtpConfig RTP configuration options
 * @param processorOptions Processor options for handling the stream
 */
export function attachStreamToRtpTransport(
  transport: T140RtpTransport,
  stream: TextDataStream,
  rtpConfig: RtpConfig = {},
  processorOptions: ProcessorOptions = {}
): void {
  let textBuffer = '';
  const processBackspaces =
    processorOptions.processBackspaces || rtpConfig.processBackspaces;
  const charRateLimit = rtpConfig.charRateLimit || DEFAULT_CHAR_RATE_LIMIT;
  const charQueue: string[] = [];
  let lastSendTime = Date.now();
  let tokenBucket = charRateLimit;
  const tokenRefillRate = charRateLimit / TOKEN_REFILL_RATE_DIVISOR;

  const sendInterval = setInterval(() => {
    const now = Date.now();
    const elapsedMs = now - lastSendTime;
    lastSendTime = now;
    tokenBucket = Math.min(
      charRateLimit,
      tokenBucket + elapsedMs * tokenRefillRate
    );

    while (charQueue.length > 0 && tokenBucket >= MIN_TOKEN_BUCKET_VALUE) {
      const charsToSend = Math.min(Math.floor(tokenBucket), charQueue.length);
      const textChunk = charQueue.splice(0, charsToSend).join('');

      if (textChunk) {
        transport.sendText(textChunk);
        tokenBucket -= textChunk.length;
      }
    }
  }, SEND_INTERVAL_MS);

  stream.on('data', (chunk) => {
    const { text, metadata } = extractTextFromChunk(chunk);

    if (
      metadata &&
      processorOptions.handleMetadata !== false &&
      rtpConfig.handleMetadata !== false
    ) {
      stream.emit('metadata', metadata);
      const metadataCallback =
        processorOptions.metadataCallback || rtpConfig.metadataCallback;
      if (metadataCallback) {
        metadataCallback(metadata);
      }
    }

    if (!text) return;

    if (processBackspaces) {
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer
      );
      textBuffer = updatedBuffer;

      if (processedText) {
        charQueue.push(...toGraphemes(processedText));
      }
    } else {
      charQueue.push(...toGraphemes(text));
    }
  });

  stream.on('end', () => {
    clearInterval(sendInterval);
    if (charQueue.length > 0) {
      transport.sendText(charQueue.join(''));
    }
    transport.close();
  });

  stream.on('error', (_err) => {
    clearInterval(sendInterval);
    transport.close();
  });
}

/**
 * Create a T140 RTP transport that can be used to send T.140 data
 *
 * @param remoteAddress Remote address to send packets to
 * @param remotePort Remote port to send packets to
 * @param rtpConfig RTP configuration options
 * @returns The transport and a function to attach a stream to it
 */
export function createT140RtpTransport(
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  rtpConfig: RtpConfig = {}
): {
  transport: T140RtpTransport;
  attachStream: (
    stream: TextDataStream,
    processorOptions?: ProcessorOptions
  ) => void;
} {
  const transport = new T140RtpTransport(remoteAddress, remotePort, rtpConfig);

  const attachStream = (
    stream: TextDataStream,
    processorOptions: ProcessorOptions = {}
  ) => {
    attachStreamToRtpTransport(transport, stream, rtpConfig, processorOptions);
  };

  return {
    transport,
    attachStream,
  };
}

/**
 * Process an AI stream and send chunks directly as T.140 over RTP
 * with rate limiting to ensure compliance with specified character rate limits
 *
 * @param stream The AI stream to process
 * @param remoteAddress Remote address to send packets to
 *  (required if customTransport is not provided)
 * @param remotePort Remote port to send packets to (defaults to DEFAULT_RTP_PORT)
 * @param rtpConfig Configuration options including custom transport
 * @param existingTransport Optional existing T140RtpTransport to use
 * @returns T140RtpTransport instance
 */
export function processAIStreamToRtp(
  stream: TextDataStream,
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  rtpConfig: RtpConfig = {},
  existingTransport?: T140RtpTransport
): T140RtpTransport {
  const processorOptions: ProcessorOptions = {
    processBackspaces: rtpConfig.processBackspaces,
    handleMetadata: rtpConfig.handleMetadata,
    metadataCallback: rtpConfig.metadataCallback,
  };

  if (existingTransport) {
    // Attach stream directly to the existing transport
    attachStreamToRtpTransport(existingTransport, stream, rtpConfig, processorOptions);
    return existingTransport;
  }

  // Create a new transport and attach the stream
  const { transport, attachStream } = createT140RtpTransport(
    remoteAddress,
    remotePort,
    rtpConfig
  );

  attachStream(stream, processorOptions);

  return transport;
}
