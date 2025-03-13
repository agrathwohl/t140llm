import * as net from 'net';
import {
  LLMMetadata,
  ProcessorOptions,
  RtpConfig,
  TextDataStream,
  TransportStream,
} from '../interfaces';
import { createRtpPacket } from '../rtp/create-rtp-packet';
import { processT140BackspaceChars } from '../utils/backspace-processing';
import {
  DEFAULT_T140_PAYLOAD_TYPE,
  SEQPACKET_SOCKET_PATH,
} from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';
import { generateSecureSSRC } from '../utils/security';

/**
 * Creates a direct socket transport for T.140 RTP transmission
 *
 * @param socketPath Path to the SEQPACKET socket
 * @param rtpConfig RTP configuration options
 * @returns The transport and a function to attach a stream to it
 */
export function createDirectSocketTransport(
  socketPath: string = SEQPACKET_SOCKET_PATH,
  rtpConfig: RtpConfig = {}
): {
  transport: net.Socket | TransportStream;
  attachStream: (
    stream: TextDataStream,
    processorOptions?: ProcessorOptions
  ) => void;
  rtpState: {
    sequenceNumber: number;
    timestamp: number;
    ssrc: number;
  };
} {
  // Create Unix SEQPACKET socket if no custom transport provided
  const transport =
    rtpConfig.customTransport || net.createConnection(socketPath);

  // Initialize RTP parameters
  const sequenceNumber = rtpConfig.initialSequenceNumber || 0;
  const timestamp = rtpConfig.initialTimestamp || 0;
  const timestampIncrement = rtpConfig.timestampIncrement || 160;
  const payloadType = rtpConfig.payloadType || DEFAULT_T140_PAYLOAD_TYPE;
  const ssrc = rtpConfig.ssrc || generateSecureSSRC(); // Use secure SSRC

  // Track RTP state for external access
  const rtpState = {
    sequenceNumber,
    timestamp,
    ssrc,
  };

  // Function to attach a stream to this transport
  const attachStream = (
    stream: TextDataStream,
    processorOptions: ProcessorOptions = {}
  ) => {
    let textBuffer = ''; // Buffer to track accumulated text for backspace handling
    const processBackspaces =
      processorOptions.processBackspaces === true ||
      rtpConfig.processBackspaces === true;
    const handleMetadata =
      processorOptions.handleMetadata !== false &&
      rtpConfig.handleMetadata !== false; // Default to true
    const metadataCallback =
      processorOptions.metadataCallback || rtpConfig.metadataCallback;

    // Function to create and send metadata packets
    const sendMetadataPacket = (metadata: LLMMetadata) => {
      // We use a special JSON encoding for metadata packets
      const metadataJson = JSON.stringify({
        type: 'metadata',
        content: metadata,
      });

      // Create RTP packet with metadata (using a special content-type marker)
      const metadataPacket = createRtpPacket(
        rtpState.sequenceNumber,
        rtpState.timestamp,
        metadataJson,
        {
          payloadType,
          ssrc,
          metadataPacket: true, // Special marker for metadata packets
        }
      );

      // Send to the transport
      if (rtpConfig.customTransport) {
        transport.send(metadataPacket, (err) => {
          if (err) {
            console.error(
              'Error sending metadata packet to custom transport:',
              err
            );
          }
        });
      } else {
        // If using default socket
        (transport as net.Socket).write(metadataPacket);
      }

      // Update sequence number and timestamp for next packet
      rtpState.sequenceNumber = (rtpState.sequenceNumber + 1) % 65536;
      rtpState.timestamp += timestampIncrement;
    };

    // Process the AI stream and send chunks directly to the transport
    stream.on('data', (chunk) => {
      // Extract the text content and metadata from the chunk
      const { text, metadata } = extractTextFromChunk(chunk);

      // If metadata is present and handling is enabled
      if (handleMetadata && metadata) {
        // Emit metadata event for external handling
        stream.emit('metadata', metadata);

        // Call metadata callback if provided
        if (metadataCallback && typeof metadataCallback === 'function') {
          metadataCallback(metadata);
        }

        // Send metadata packet if enabled
        if (
          rtpConfig.sendMetadataAsPackets ||
          processorOptions.sendMetadataOverTransport
        ) {
          sendMetadataPacket(metadata);
        }
      }

      // Skip if no text content
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
      const rtpPacket = createRtpPacket(
        rtpState.sequenceNumber,
        rtpState.timestamp,
        textToSend,
        {
          payloadType,
          ssrc,
        }
      );

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
      rtpState.sequenceNumber = (rtpState.sequenceNumber + 1) % 65536;
      rtpState.timestamp += timestampIncrement;
    });

    // Handle metadata events from the stream
    if (handleMetadata) {
      stream.on('metadata', (metadata: LLMMetadata) => {
        // This handler catches metadata that might be emitted separately
        // (not directly from the data chunks)

        // Call metadata callback if provided
        if (metadataCallback && typeof metadataCallback === 'function') {
          metadataCallback(metadata);
        }

        // Send metadata packet if enabled
        if (
          rtpConfig.sendMetadataAsPackets ||
          processorOptions.sendMetadataOverTransport
        ) {
          sendMetadataPacket(metadata);
        }
      });
    }

    stream.on('end', () => {
      // Close the transport when stream ends
      if (
        rtpConfig.customTransport &&
        typeof rtpConfig.customTransport.close === 'function'
      ) {
        rtpConfig.customTransport.close();
      } else if (transport instanceof net.Socket) {
        transport.end();
      }
    });

    stream.on('error', (err) => {
      console.error('AI Stream error:', err);
      // Close the transport
      if (
        rtpConfig.customTransport &&
        typeof rtpConfig.customTransport.close === 'function'
      ) {
        rtpConfig.customTransport.close();
      } else if (transport instanceof net.Socket) {
        transport.end();
      }
    });
  };

  return {
    transport,
    attachStream,
    rtpState,
  };
}

/**
 * Process an AI stream and send chunks as RTP directly to a SEQPACKET socket
 * This is the "direct socket mode" which bypasses WebSocket but still uses RTP encapsulation
 *
 * @param stream The AI stream to process
 * @param socketPath Path to the SEQPACKET socket (ignored if customTransport is provided)
 * @param rtpConfig RTP configuration including custom transport if needed
 * @param existingTransport Optional existing transport to use instead of creating a new one
 * @returns Socket or custom transport
 */
export function processAIStreamToDirectSocket(
  stream: TextDataStream,
  socketPath: string = SEQPACKET_SOCKET_PATH,
  rtpConfig: RtpConfig = {},
  existingTransport?: net.Socket | TransportStream
): net.Socket | TransportStream {
  // If an existing transport is provided, use it
  if (existingTransport) {
    const processorOptions: ProcessorOptions = {
      processBackspaces: rtpConfig.processBackspaces,
      handleMetadata: rtpConfig.handleMetadata,
      metadataCallback: rtpConfig.metadataCallback,
      sendMetadataOverTransport: rtpConfig.sendMetadataAsPackets,
    };

    const { attachStream } = createDirectSocketTransport(socketPath, rtpConfig);
    attachStream(stream, processorOptions);

    return existingTransport;
  }

  // Otherwise create a new transport
  const { transport, attachStream } = createDirectSocketTransport(
    socketPath,
    rtpConfig
  );

  // Attach the stream to the connection
  const processorOptions: ProcessorOptions = {
    processBackspaces: rtpConfig.processBackspaces,
    handleMetadata: rtpConfig.handleMetadata,
    metadataCallback: rtpConfig.metadataCallback,
    sendMetadataOverTransport: rtpConfig.sendMetadataAsPackets,
  };

  attachStream(stream, processorOptions);

  return transport;
}
