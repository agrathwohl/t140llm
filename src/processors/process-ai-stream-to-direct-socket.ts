import createDebug from 'debug';
import * as net from 'net';
import {
  LLMMetadata,
  ProcessorOptions,
  RtpConfig,
  TextDataStream,
  TransportStream,
} from '../interfaces';
import { createRtpPacket } from '../rtp/create-rtp-packet';
import { createT140Clock } from '../rtp/t140-clock';
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

const debug = createDebug('t140llm:direct-socket');

/** RTP stream state shared by every stream attached to one direct socket transport. */
export interface DirectSocketRtpState {
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
}

function isTransportStream(transport: net.Socket | TransportStream): transport is TransportStream {
  return typeof (transport as TransportStream).send === 'function';
}

/**
 * Attach a stream to an existing direct socket transport. Each text chunk is
 * framed as one RTP packet and written to the socket, with no pacing.
 *
 * @param transport The existing transport (Socket or TransportStream)
 * @param stream The stream to attach
 * @param rtpConfig RTP configuration options
 * @param processorOptions Processor options; override the matching rtpConfig fields
 * @param rtpState Optional RTP state to continue from (defaults from rtpConfig)
 */
export function attachStreamToDirectSocketTransport(
  transport: net.Socket | TransportStream,
  stream: TextDataStream,
  rtpConfig: RtpConfig = {},
  processorOptions: ProcessorOptions = {},
  rtpState?: DirectSocketRtpState
): void {
  const state = rtpState ?? {
    sequenceNumber: rtpConfig.initialSequenceNumber ?? 0,
    timestamp: rtpConfig.initialTimestamp ?? 0,
    ssrc: rtpConfig.ssrc ?? generateSecureSSRC(),
  };
  const clock = createT140Clock(state.timestamp, rtpConfig.timestampIncrement);
  const payloadType = rtpConfig.payloadType ?? DEFAULT_T140_PAYLOAD_TYPE;

  const sendPacket = (payload: string, metadataPacket = false): void => {
    state.timestamp = clock.next();
    const packet = createRtpPacket(state.sequenceNumber, state.timestamp, payload, {
      payloadType,
      metadataPacket,
      ssrc: state.ssrc,
    });
    state.sequenceNumber = (state.sequenceNumber + 1) % RTP_MAX_SEQUENCE_NUMBER;

    if (isTransportStream(transport)) {
      transport.send(packet);
    } else {
      transport.write(packet);
    }
  };

  const sendMetadataPacket = (metadata: LLMMetadata): void => {
    const metadataJson = JSON.stringify({ type: 'metadata', content: metadata });
    if (Buffer.byteLength(metadataJson, 'utf-8') > MAX_METADATA_PAYLOAD_SIZE) {
      return;
    }
    sendPacket(metadataJson, true);
  };

  const options = resolveStreamOptions(processorOptions, {
    processBackspaces: rtpConfig.processBackspaces,
    handleMetadata: rtpConfig.handleMetadata,
    metadataCallback: rtpConfig.metadataCallback,
    sendMetadataOverTransport: rtpConfig.sendMetadataAsPackets,
    onError: rtpConfig.onError,
  });

  attachStreamProcessor(stream, options, {
    sendText: (text) => sendPacket(text),
    sendMetadata: sendMetadataPacket,
    close: () => {
      if (isTransportStream(transport)) {
        transport.close?.();
      } else {
        transport.end();
      }
    },
  });
}

/**
 * Create a direct socket transport for T.140 RTP transmission.
 *
 * @param socketPath Path to the SEQPACKET socket
 * @param rtpConfig RTP configuration options
 * @returns The transport, a function to attach a stream to it, and the shared RTP state
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
  rtpState: DirectSocketRtpState;
} {
  const transport = rtpConfig.customTransport ?? net.createConnection(socketPath);
  if (!isTransportStream(transport)) {
    // The socket exists before any stream is attached, so handle its errors
    // here. Without this a refused connection would exit the process.
    transport.on('error', (err) => {
      debug('socket error: %O', err);
      rtpConfig.onError?.(err);
    });
  }

  const rtpState: DirectSocketRtpState = {
    sequenceNumber: rtpConfig.initialSequenceNumber ?? 0,
    timestamp: rtpConfig.initialTimestamp ?? 0,
    ssrc: rtpConfig.ssrc ?? generateSecureSSRC(),
  };

  return {
    transport,
    rtpState,
    attachStream: (stream, processorOptions = {}) => {
      attachStreamToDirectSocketTransport(transport, stream, rtpConfig, processorOptions, rtpState);
    },
  };
}

/**
 * Stream an LLM response as RTP frames to a Unix SEQPACKET socket.
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
    attachStreamToDirectSocketTransport(existingTransport, stream, rtpConfig);
    return existingTransport;
  }

  const { transport, attachStream } = createDirectSocketTransport(socketPath, rtpConfig);
  attachStream(stream);
  return transport;
}
