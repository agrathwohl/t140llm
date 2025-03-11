import { RtpConfig, TextDataStream } from '../interfaces';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { processT140BackspaceChars } from '../utils/backspace-processing';
import { DEFAULT_RTP_PORT } from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';

/**
 * Process an AI stream and send chunks directly as T.140 over RTP
 * with rate limiting to ensure compliance with specified character rate limits
 *
 * @param stream The AI stream to process
 * @param remoteAddress Remote address to send packets to (required if customTransport is not provided)
 * @param remotePort Remote port to send packets to (defaults to DEFAULT_RTP_PORT)
 * @param rtpConfig Configuration options including custom transport
 * @returns T140RtpTransport instance
 */
export function processAIStreamToRtp(
  stream: TextDataStream,
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  rtpConfig: RtpConfig = {}
): T140RtpTransport {
  // If a custom transport is provided, we still need to pass remoteAddress and remotePort
  // for backward compatibility, but they won't be used for sending
  const transport = new T140RtpTransport(remoteAddress, remotePort, rtpConfig);
  let textBuffer = ''; // Buffer to track accumulated text for backspace handling
  const processBackspaces = rtpConfig.processBackspaces === true;

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
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
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

  // Forward errors from the transport to any listeners attached to the transport
  transport.on('error', (err) => {
    // The error is already emitted by the transport, no need to re-emit
    // Just log for debugging if needed
    console.error(`T140RtpTransport error (${err.type}):`, err.message);
  });

  return transport;
}
