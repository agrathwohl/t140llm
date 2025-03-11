import { SrtpConfig, TextDataStream } from '../interfaces';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { processT140BackspaceChars } from '../utils/backspace-processing';
import { DEFAULT_SRTP_PORT } from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';

/**
 * Process an AI stream and send chunks directly as T.140 over SRTP
 *
 * @param stream The AI stream to process
 * @param remoteAddress Remote address to send packets to (required if customTransport is not provided)
 * @param srtpConfig SRTP configuration including custom transport if needed
 * @param remotePort Remote port to send packets to (defaults to DEFAULT_SRTP_PORT)
 * @returns T140RtpTransport instance
 */
export function processAIStreamToSrtp(
  stream: TextDataStream,
  remoteAddress: string,
  srtpConfig: SrtpConfig,
  remotePort: number = DEFAULT_SRTP_PORT
): T140RtpTransport {
  // Create transport
  const transport = new T140RtpTransport(remoteAddress, remotePort, srtpConfig);
  let textBuffer = ''; // Buffer to track accumulated text for backspace handling
  const processBackspaces = srtpConfig.processBackspaces === true;

  // Setup SRTP
  transport.setupSrtp(srtpConfig);

  // Process the AI stream and send chunks over SRTP
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

      // Only send if there's something to send
      if (processedText) {
        transport.sendText(processedText);
      }
    } else {
      // Send text directly without backspace processing
      transport.sendText(text);
    }
  });

  stream.on('end', () => {
    // Close the transport when stream ends
    transport.close();
  });

  // Handle errors from the input stream
  stream.on('error', (err) => {
    console.error('AI Stream error:', err);
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
