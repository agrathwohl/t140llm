import { ProcessorOptions, RtpConfig, TextDataStream } from '../interfaces';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { processT140BackspaceChars } from '../utils/backspace-processing';
import { DEFAULT_RTP_PORT } from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';

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
  transport: T140RtpTransport,
  attachStream: (stream: TextDataStream, processorOptions?: ProcessorOptions) => void
} {
  // Create the RTP transport
  const transport = new T140RtpTransport(remoteAddress, remotePort, rtpConfig);

  // Function to attach a stream to this transport
  const attachStream = (stream: TextDataStream, processorOptions: ProcessorOptions = {}) => {
    let textBuffer = ''; // Buffer to track accumulated text for backspace handling
    const processBackspaces = processorOptions.processBackspaces === true || rtpConfig.processBackspaces === true;

    // Rate limiting configuration - default to 30 characters per second
    const charRateLimit = rtpConfig.charRateLimit || 30; // characters per second
    const charQueue: string[] = []; // Queue to store characters waiting to be sent
    let lastSendTime = Date.now();
    let tokenBucket = charRateLimit; // Initial tokens available (full bucket)
    const tokenRefillRate = charRateLimit / 1000; // Tokens per millisecond

    // Set up the rate limiting interval
    const sendInterval = setInterval(() => {
      // Refill the token bucket
      const now = Date.now();
      const elapsedMs = now - lastSendTime;
      lastSendTime = now;

      // Add tokens based on elapsed time
      tokenBucket = Math.min(
        charRateLimit,
        tokenBucket + elapsedMs * tokenRefillRate
      );

      // If we have characters in the queue and tokens available, send them
      while (charQueue.length > 0 && tokenBucket >= 1) {
        const charsToSend = Math.min(Math.floor(tokenBucket), charQueue.length);
        const textChunk = charQueue.splice(0, charsToSend).join('');

        if (textChunk) {
          transport.sendText(textChunk);
          tokenBucket = tokenBucket - textChunk.length;
        }
      }
    }, 100); // Check every 100ms

    // Process the AI stream and add chunks to the rate-limited queue
    stream.on('data', (chunk) => {
      // Extract the text content and metadata from the chunk
      const { text, metadata } = extractTextFromChunk(chunk);

      // Handle metadata if present
      if (metadata && (processorOptions.handleMetadata !== false && rtpConfig.handleMetadata !== false)) {
        // Emit metadata event for external handling
        stream.emit('metadata', metadata);

        // Call metadata callback if provided
        const metadataCallback = processorOptions.metadataCallback || rtpConfig.metadataCallback;
        if (metadataCallback && typeof metadataCallback === 'function') {
          metadataCallback(metadata);
        }
      }

      // Skip if no text content
      if (!text) return;

      if (processBackspaces) {
        // Process backspaces in the T.140 stream
        const { processedText, updatedBuffer } = processT140BackspaceChars(
          text,
          textBuffer
        );
        textBuffer = updatedBuffer;

        // Only queue if there's something to send
        if (processedText) {
          // Add each character to the queue for rate limiting
          for (const char of processedText) {
            charQueue.push(char);
          }
        }
      } else {
        // Add each character to the queue for rate limiting
        for (const char of text) {
          charQueue.push(char);
        }
      }
    });

    stream.on('end', () => {
      // Clear the send interval
      clearInterval(sendInterval);

      // Send any remaining characters in the queue
      if (charQueue.length > 0) {
        transport.sendText(charQueue.join(''));
      }

      // Close the transport when stream ends
      transport.close();
    });

    // Handle errors from the input stream
    stream.on('error', (err) => {
      console.error('AI Stream error:', err);
      clearInterval(sendInterval);
      transport.close();
    });
  };

  // Forward errors from the transport for debugging
  transport.on('error', (err) => {
    console.error(`T140RtpTransport error (${err.type}):`, err.message);
  });

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
  // If an existing transport is provided, use it
  if (existingTransport) {
    const processorOptions: ProcessorOptions = {
      processBackspaces: rtpConfig.processBackspaces,
      handleMetadata: rtpConfig.handleMetadata,
      metadataCallback: rtpConfig.metadataCallback,
    };

    const { attachStream } = createT140RtpTransport(remoteAddress, remotePort, rtpConfig);
    attachStream(stream, processorOptions);

    return existingTransport;
  }

  // Otherwise create a new transport
  const { transport, attachStream } = createT140RtpTransport(remoteAddress, remotePort, rtpConfig);

  // Attach the stream to the transport
  const processorOptions: ProcessorOptions = {
    processBackspaces: rtpConfig.processBackspaces,
    handleMetadata: rtpConfig.handleMetadata,
    metadataCallback: rtpConfig.metadataCallback,
  };

  attachStream(stream, processorOptions);

  return transport;
}
