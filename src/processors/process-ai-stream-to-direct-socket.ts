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
  const transport =
    rtpConfig.customTransport || net.createConnection(socketPath);

  const sequenceNumber = rtpConfig.initialSequenceNumber || 0;
  const timestamp = rtpConfig.initialTimestamp || 0;
  const timestampIncrement = rtpConfig.timestampIncrement || 160;
  const payloadType = rtpConfig.payloadType || DEFAULT_T140_PAYLOAD_TYPE;
  const ssrc = rtpConfig.ssrc || generateSecureSSRC();

  const rtpState = {
    sequenceNumber,
    timestamp,
    ssrc,
  };

  const sendPacket = (packet: Buffer) => {
    if (rtpConfig.customTransport) {
      transport.send(packet, (err) => {
        if (err) {
          console.error('Error sending packet to custom transport:', err);
        }
      });
    } else {
      (transport as net.Socket).write(packet);
    }
  };

  const sendMetadataPacket = (metadata: LLMMetadata) => {
    const metadataJson = JSON.stringify({
      type: 'metadata',
      content: metadata,
    });

    const metadataPacket = createRtpPacket(
      rtpState.sequenceNumber,
      rtpState.timestamp,
      metadataJson,
      {
        payloadType,
        ssrc,
        metadataPacket: true,
      }
    );

    sendPacket(metadataPacket);

    rtpState.sequenceNumber = (rtpState.sequenceNumber + 1) % 65536;
    rtpState.timestamp += timestampIncrement;
  };

  const attachStream = (
    stream: TextDataStream,
    processorOptions: ProcessorOptions = {}
  ) => {
    let textBuffer = '';
    const processBackspaces =
      processorOptions.processBackspaces ?? rtpConfig.processBackspaces;
    const handleMetadata =
      processorOptions.handleMetadata ?? rtpConfig.handleMetadata ?? true;
    const metadataCallback =
      processorOptions.metadataCallback || rtpConfig.metadataCallback;

    stream.on('data', (chunk) => {
      const { text, metadata } = extractTextFromChunk(chunk);

      if (handleMetadata && metadata) {
        stream.emit('metadata', metadata);
        metadataCallback?.(metadata);

        if (
          rtpConfig.sendMetadataAsPackets ||
          processorOptions.sendMetadataOverTransport
        ) {
          sendMetadataPacket(metadata);
        }
      }

      if (!text) return;

      let textToSend = text;

      if (processBackspaces) {
        const { processedText, updatedBuffer } = processT140BackspaceChars(
          text,
          textBuffer
        );
        textBuffer = updatedBuffer;
        textToSend = processedText;

        if (!textToSend) return;
      }

      const rtpPacket = createRtpPacket(
        rtpState.sequenceNumber,
        rtpState.timestamp,
        textToSend,
        {
          payloadType,
          ssrc,
        }
      );

      sendPacket(rtpPacket);

      rtpState.sequenceNumber = (rtpState.sequenceNumber + 1) % 65536;
      rtpState.timestamp += timestampIncrement;
    });

    if (handleMetadata) {
      stream.on('metadata', (metadata: LLMMetadata) => {
        metadataCallback?.(metadata);

        if (
          rtpConfig.sendMetadataAsPackets ||
          processorOptions.sendMetadataOverTransport
        ) {
          sendMetadataPacket(metadata);
        }
      });
    }

    const closeTransport = () => {
      if (rtpConfig.customTransport?.close) {
        rtpConfig.customTransport.close();
      } else if (transport instanceof net.Socket) {
        transport.end();
      }
    };

    stream.on('end', closeTransport);
    stream.on('error', (err) => {
      console.error('AI Stream error:', err);
      closeTransport();
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

  const { transport, attachStream } = createDirectSocketTransport(
    socketPath,
    rtpConfig
  );

  const processorOptions: ProcessorOptions = {
    processBackspaces: rtpConfig.processBackspaces,
    handleMetadata: rtpConfig.handleMetadata,
    metadataCallback: rtpConfig.metadataCallback,
    sendMetadataOverTransport: rtpConfig.sendMetadataAsPackets,
  };

  attachStream(stream, processorOptions);

  return transport;
}
