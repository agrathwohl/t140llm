import * as net from 'net';
import { RtpConfig, TextDataStream, TransportStream } from '../interfaces';
import { createRtpPacket } from '../rtp/create-rtp-packet';
import { processT140BackspaceChars } from '../utils/backspace-processing';
import { DEFAULT_T140_PAYLOAD_TYPE, SEQPACKET_SOCKET_PATH } from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';
import { generateSecureSSRC } from '../utils/security';

/**
 * Process an AI stream and send chunks as RTP directly to a SEQPACKET socket
 * This is the "direct socket mode" which bypasses WebSocket but still uses RTP encapsulation
 *
 * @param stream The AI stream to process
 * @param socketPath Path to the SEQPACKET socket (ignored if customTransport is provided)
 * @param rtpConfig RTP configuration including custom transport if needed
 * @returns Socket or custom transport
 */
export function processAIStreamToDirectSocket(
  stream: TextDataStream,
  socketPath: string = SEQPACKET_SOCKET_PATH,
  rtpConfig: RtpConfig = {}
): net.Socket | TransportStream {
  // Create Unix SEQPACKET socket if no custom transport provided
  const transport = rtpConfig.customTransport || net.createConnection(socketPath);

  // Initialize RTP parameters
  let sequenceNumber = rtpConfig.initialSequenceNumber || 0;
  let timestamp = rtpConfig.initialTimestamp || 0;
  const timestampIncrement = rtpConfig.timestampIncrement || 160;
  const payloadType = rtpConfig.payloadType || DEFAULT_T140_PAYLOAD_TYPE;
  const ssrc = rtpConfig.ssrc || generateSecureSSRC(); // Use secure SSRC
  let textBuffer = ''; // Buffer to track accumulated text for backspace handling
  const processBackspaces = rtpConfig.processBackspaces === true;

  // Process the AI stream and send chunks directly to the transport
  stream.on('data', (chunk) => {
    // Extract the text content from the chunk
    const text = extractTextFromChunk(chunk);
    if (!text) return;

    let textToSend = text;

    if (processBackspaces) {
      // Process backspaces in the T.140 stream
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer
      );
      textBuffer = updatedBuffer;
      textToSend = processedText;

      // Skip if nothing to send
      if (!textToSend) return;
    }

    // Create RTP packet for T.140
    const rtpPacket = createRtpPacket(sequenceNumber, timestamp, textToSend, {
      payloadType,
      ssrc,
    });

    // Send to the transport
    if (rtpConfig.customTransport) {
      transport.send(rtpPacket, (err) => {
        if (err) {
          console.error('Error sending packet to custom transport:', err);
        }
      });
    } else {
      // If using default socket
      (transport as net.Socket).write(rtpPacket);
    }

    // Update sequence number and timestamp for next packet
    sequenceNumber = (sequenceNumber + 1) % 65536;
    timestamp += timestampIncrement;
  });

  stream.on('end', () => {
    // Close the transport when stream ends
    if (rtpConfig.customTransport && typeof rtpConfig.customTransport.close === 'function') {
      rtpConfig.customTransport.close();
    } else if (transport instanceof net.Socket) {
      transport.end();
    }
  });

  stream.on('error', (err) => {
    console.error('AI Stream error:', err);
    // Close the transport
    if (rtpConfig.customTransport && typeof rtpConfig.customTransport.close === 'function') {
      rtpConfig.customTransport.close();
    } else if (transport instanceof net.Socket) {
      transport.end();
    }
  });

  return transport;
}
