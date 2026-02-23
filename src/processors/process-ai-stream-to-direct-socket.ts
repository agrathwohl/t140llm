import * as net from 'net';
import {
  LLMMetadata,
  ProcessorOptions,
  RtpConfig,
  TextDataStream,
  TransportStream,
} from '../interfaces';
import { createRtpPacket } from '../rtp/create-rtp-packet';
import {
  DEFAULT_T140_PAYLOAD_TYPE,
  MAX_METADATA_PAYLOAD_SIZE,
  RTP_MAX_SEQUENCE_NUMBER,
  SEQPACKET_SOCKET_PATH,
} from '../utils/constants';
import { generateSecureSSRC } from '../utils/security';
import {
  attachStreamProcessor,
  resolveStreamOptions,
} from '../utils/stream-processor';

/**
 * Attach a stream to an existing direct socket transport
 *
 * @param transport The existing transport (Socket or TransportStream)
 * @param stream The stream to attach
 * @param rtpConfig RTP configuration options
 * @param processorOptions Processor options for handling the stream
 * @param rtpState Optional RTP state to use (if not provided, will use defaults from rtpConfig)
 */
export function attachStreamToDirectSocketTransport(
  transport: net.Socket | TransportStream,
  stream: TextDataStream,
  rtpConfig: RtpConfig = {},
  processorOptions: ProcessorOptions = {},
  rtpState?: { sequenceNumber: number; timestamp: number; ssrc: number }
): void {
  const state = rtpState ?? {
    sequenceNumber: rtpConfig.initialSequenceNumber ?? 0,
    timestamp: rtpConfig.initialTimestamp ?? 0,
    ssrc: rtpConfig.ssrc ?? generateSecureSSRC(),
  };
  const timestampIncrement = rtpConfig.timestampIncrement || 160;
  const payloadType = rtpConfig.payloadType || DEFAULT_T140_PAYLOAD_TYPE;

  const sendPacket = (packet: Buffer) => {
    if (rtpConfig.customTransport || 'send' in transport) {
      (transport as TransportStream).send(packet);
    } else {
      (transport as net.Socket).write(packet);
    }
  };

  const sendMetadataPacket = (metadata: LLMMetadata) => {
    const metadataJson = JSON.stringify({
      type: 'metadata',
      content: metadata,
    });
    if (Buffer.byteLength(metadataJson, 'utf-8') > MAX_METADATA_PAYLOAD_SIZE) {
      return;
    }
    const metadataPacket = createRtpPacket(
      state.sequenceNumber, state.timestamp, metadataJson,
      { payloadType, ssrc: state.ssrc, metadataPacket: true }
    );
    sendPacket(metadataPacket);
    state.sequenceNumber = (state.sequenceNumber + 1) % RTP_MAX_SEQUENCE_NUMBER;
    state.timestamp += timestampIncrement;
  };

  const closeTransport = () => {
    if (rtpConfig.customTransport?.close) {
      rtpConfig.customTransport.close();
    } else if ('close' in transport && typeof transport.close === 'function') {
      transport.close();
    } else if (transport instanceof net.Socket) {
      transport.end();
    }
  };

  const options = resolveStreamOptions(processorOptions, {
    processBackspaces: rtpConfig.processBackspaces,
    handleMetadata: rtpConfig.handleMetadata,
    metadataCallback: rtpConfig.metadataCallback,
    sendMetadataOverTransport: rtpConfig.sendMetadataAsPackets,
  });

  attachStreamProcessor(stream, options, {
    sendText: (text) => {
      const rtpPacket = createRtpPacket(
        state.sequenceNumber, state.timestamp, text,
        { payloadType, ssrc: state.ssrc }
      );
      sendPacket(rtpPacket);
      state.sequenceNumber = (state.sequenceNumber + 1) % RTP_MAX_SEQUENCE_NUMBER;
      state.timestamp += timestampIncrement;
    },
    sendMetadata: (metadata) => sendMetadataPacket(metadata),
    close: closeTransport,
  });
}

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

  const rtpState = {
    sequenceNumber: rtpConfig.initialSequenceNumber || 0,
    timestamp: rtpConfig.initialTimestamp || 0,
    ssrc: rtpConfig.ssrc || generateSecureSSRC(),
  };

  const attachStream = (
    stream: TextDataStream,
    processorOptions: ProcessorOptions = {}
  ) => {
    attachStreamToDirectSocketTransport(
      transport, stream, rtpConfig, processorOptions, rtpState
    );
  };

  return { transport, attachStream, rtpState };
}

/**
 * Process an AI stream and send chunks as RTP directly to a SEQPACKET socket
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
  const processorOptions: ProcessorOptions = {
    processBackspaces: rtpConfig.processBackspaces,
    handleMetadata: rtpConfig.handleMetadata,
    metadataCallback: rtpConfig.metadataCallback,
    sendMetadataOverTransport: rtpConfig.sendMetadataAsPackets,
  };

  if (existingTransport) {
    attachStreamToDirectSocketTransport(existingTransport, stream, rtpConfig, processorOptions);
    return existingTransport;
  }

  const { transport, attachStream } = createDirectSocketTransport(
    socketPath, rtpConfig
  );
  attachStream(stream, processorOptions);
  return transport;
}
