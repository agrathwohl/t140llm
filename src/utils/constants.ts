// WebSocket server address and port
export const WS_SERVER_PORT = 8765;

// Unix SEQPACKET socket path
export const SEQPACKET_SOCKET_PATH = '/tmp/seqpacket_socket';

// RTP/SRTP defaults
export const RTP_HEADER_SIZE = 12;
export const DEFAULT_RTP_PORT = 5004;
export const DEFAULT_SRTP_PORT = 5006;
export const DEFAULT_T140_PAYLOAD_TYPE = 96;
export const DEFAULT_RED_PAYLOAD_TYPE = 98;
export const DEFAULT_FEC_PAYLOAD_TYPE = 97;

// RTP header constants
export const RTP_VERSION = 2;
export const RTP_MAX_SEQUENCE_NUMBER = 65536; // 16-bit max (2^16)
export const RTP_MAX_CSRC_COUNT = 15;
export const RTP_CSRC_ENTRY_SIZE = 4; // bytes

// RTP packet timing defaults
export const DEFAULT_TIMESTAMP_INCREMENT = 160; // 20ms at 8kHz sample rate
export const DEFAULT_CHAR_RATE_LIMIT = 30; // characters per second
export const SEND_INTERVAL_MS = 100; // milliseconds

// Forward Error Correction (FEC) defaults
export const DEFAULT_FEC_GROUP_SIZE = 5; // packets per FEC packet
export const FEC_HEADER_EXTENSION_SIZE = 16; // bytes

// Redundancy (RED) encoding defaults
export const DEFAULT_REDUNDANCY_LEVEL = 2; // number of redundant blocks
export const RED_MAX_BLOCK_LENGTH = 255; // 8-bit max
export const RED_HEADER_SIZE_PER_BLOCK = 4; // bytes
export const RED_PRIMARY_HEADER_SIZE = 1; // byte
export const RED_F_BIT_FLAG = 128; // 0x80 - indicates more blocks follow

// Rate limiting constants
export const TOKEN_REFILL_RATE_DIVISOR = 1000; // divisor for ms to seconds conversion
export const MIN_TOKEN_BUCKET_VALUE = 1;
export const MIN_TOKENS_PER_STREAM = 1;

// Multiplexing constants
export const INITIAL_CSRC_ID = 1;

// T.140 constants
export const BACKSPACE = '\u0008'; // ASCII backspace character (BS)

// Bit shift multipliers for RTP header encoding
export const BIT_SHIFT_64 = 64;   // Version field (bits 0-1)
export const BIT_SHIFT_32 = 32;   // Padding bit
export const BIT_SHIFT_16 = 16;   // Extension bit
export const BIT_SHIFT_128 = 128; // Marker bit
