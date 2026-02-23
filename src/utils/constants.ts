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
export const FEC_HEADER_EXTENSION_SIZE = 12; // bytes - RFC 5109 FEC header size

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


// Metadata and multiplexing payload limits
export const MAX_METADATA_PAYLOAD_SIZE = 1200; // Safe for UDP without fragmentation
export const MULTIPLEX_STREAM_DELIMITER = '\x1E'; // ASCII Record Separator - avoids colon ambiguity
// T.140 constants
export const BACKSPACE = '\u0008'; // ASCII backspace character (BS)

// Bit shift multipliers for RTP header encoding
export const BIT_SHIFT_64 = 64;   // Version field (bits 0-1)
export const BIT_SHIFT_32 = 32;   // Padding bit
export const BIT_SHIFT_16 = 16;   // Extension bit
export const BIT_SHIFT_128 = 128; // Marker bit

// RTP header byte offsets per RFC 3550
export const RTP_OFFSET_VERSION = 0;      // Byte 0: Version, padding, extension, CSRC count
export const RTP_OFFSET_PAYLOAD_TYPE = 1; // Byte 1: Marker bit, payload type
export const RTP_OFFSET_SEQUENCE = 2;     // Bytes 2-3: Sequence number
export const RTP_OFFSET_TIMESTAMP = 4;    // Bytes 4-7: Timestamp
export const RTP_OFFSET_SSRC = 8;         // Bytes 8-11: SSRC
export const RTP_OFFSET_CSRC = 12;        // Bytes 12+: CSRC list (variable)

// FEC Header Extension offsets per RFC 5109
export const FEC_EXT_OFFSET_FLAGS = 0;           // Byte 0: E, L, P, X, CC, M bits
export const FEC_EXT_OFFSET_MEDIA_PT = 1;        // Byte 1: Original media payload type
export const FEC_EXT_OFFSET_SN_BASE = 2;         // Bytes 2-3: Sequence number base
export const FEC_EXT_OFFSET_TIMESTAMP = 4;       // Bytes 4-7: Timestamp recovery
export const FEC_EXT_OFFSET_LENGTH = 8;          // Bytes 8-9: Length recovery
export const FEC_EXT_OFFSET_MASK = 10;           // Bytes 10-11: Protection mask

// RED header block offsets per RFC 2198
export const RED_OFFSET_BLOCK_HEADER = 0;        // Block header: F bit + payload type
export const RED_OFFSET_TIMESTAMP_OFFSET = 1;    // Timestamp offset (2 bytes)
export const RED_OFFSET_BLOCK_LENGTH = 3;        // Block length (1 byte)
export const RED_BLOCK_HEADER_SIZE = 4;          // Total: 4 bytes per redundant block

// SRTP key derivation sizes per RFC 3711
export const SRTP_MASTER_KEY_SIZE = 16;          // 128 bits
export const SRTP_MASTER_SALT_SIZE = 14;         // 112 bits
export const PBKDF2_TOTAL_DERIVED_SIZE = 30;     // Key + Salt = 30 bytes
export const PBKDF2_ITERATIONS = 600000;         // OWASP recommended minimum for PBKDF2-HMAC-SHA256 (2023)

// Random seed generation
export const RANDOM_SEED_SEGMENT_LENGTH = 13;    // Length of each random seed segment
