// Export everything needed from the reorganized structure
export * from './interfaces';
export * from './utils';
export * from './rtp';
export * from './processors';
export * from './transport';
// Steganography is optional - import from 't140llm/steganography' if needed
// export * from './steganography';

// For backward compatibility
import { T140RtpError, T140RtpErrorType } from './interfaces/t140-rtp-error.interface';
import {
  createT140WebSocketTransport,
  processAIStream
} from './processors/process-ai-stream';
import {
  createDirectSocketTransport,
  processAIStreamToDirectSocket
} from './processors/process-ai-stream-to-direct-socket';
import {
  createT140RtpTransport,
  processAIStreamToRtp
} from './processors/process-ai-stream-to-rtp';
import {
  createT140SrtpTransport,
  processAIStreamToSrtp
} from './processors/process-ai-stream-to-srtp';
import { createRtpPacket } from './rtp/create-rtp-packet';
import { T140RtpTransport } from './rtp/t140-rtp-transport';
// Steganography imports removed - optional module
import { createWebSocketServer } from './transport/websocket-server';
import { WebSocketServerOptions } from './transport/websocket-server';
import { processT140BackspaceChars } from './utils/backspace-processing';
import { BACKSPACE, SEQPACKET_SOCKET_PATH } from './utils/constants';
import { extractTextFromChunk } from './utils/extract-text';
import { createSrtpKeysFromPassphrase, generateSecureSSRC } from './utils/security';

// WebSocket server removed — consumers should call createWebSocketServer() explicitly

// Import new multiplexer components for direct export
import {
  addAIStreamToMultiplexer,
  createT140RtpMultiplexer,
  processAIStreamsToMultiplexedRtp
} from './processors/process-ai-stream-to-multiplex';
import { T140RtpMultiplexer } from './rtp/t140-rtp-multiplexer';
import {
  DemultiplexedStream,
  DemultiplexedStreamImpl,
  T140StreamDemultiplexer
} from './utils/demultiplex-streams';

export {
  createRtpPacket,
  createWebSocketServer,
  WebSocketServerOptions,
  SEQPACKET_SOCKET_PATH,

  // Main processor functions
  processAIStream,
  processAIStreamToRtp,
  processAIStreamToSrtp,
  processAIStreamToDirectSocket,

  // Multiplexing functions and classes
  T140RtpMultiplexer,
  createT140RtpMultiplexer,
  addAIStreamToMultiplexer,
  processAIStreamsToMultiplexedRtp,
  T140StreamDemultiplexer,
  DemultiplexedStream,
  DemultiplexedStreamImpl,

  // Steganography removed - optional module, import from 't140llm/steganography' if needed

  // Pre-create transport functions
  createT140WebSocketTransport,
  createT140RtpTransport,
  createT140SrtpTransport,
  createDirectSocketTransport,

  // Utility functions
  createSrtpKeysFromPassphrase,
  generateSecureSSRC,
  T140RtpTransport,
  processT140BackspaceChars,
  BACKSPACE,
  T140RtpErrorType,

  // Types
  T140RtpError,

  // Export for testing purposes only
  extractTextFromChunk,
};
