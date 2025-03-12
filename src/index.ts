// Export everything needed from the reorganized structure
export * from './interfaces';
export * from './utils';
export * from './rtp';
export * from './processors';
export * from './transport';

// For backward compatibility
import { T140RtpError, T140RtpErrorType } from './interfaces/t140-rtp-error.interface';
import { 
  createT140WebSocketConnection,
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
import { createWebSocketServer } from './transport/websocket-server';
import { WebSocketServerOptions } from './transport/websocket-server';
import { processT140BackspaceChars } from './utils/backspace-processing';
import { BACKSPACE, SEQPACKET_SOCKET_PATH, WS_SERVER_PORT } from './utils/constants';
import { extractTextFromChunk } from './utils/extract-text';
import { createSrtpKeysFromPassphrase, generateSecureSSRC } from './utils/security';

// Create WebSocket server (non-secure by default)
const wss = createWebSocketServer();

export {
  wss,
  createRtpPacket,
  createWebSocketServer,
  WebSocketServerOptions,
  SEQPACKET_SOCKET_PATH,
  
  // Main processor functions
  processAIStream,
  processAIStreamToRtp,
  processAIStreamToSrtp,
  processAIStreamToDirectSocket,
  
  // Pre-create transport functions
  createT140WebSocketConnection,
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
