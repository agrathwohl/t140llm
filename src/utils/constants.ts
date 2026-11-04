// WebSocket server port
export const WS_SERVER_PORT = 8765;

// Unix SEQPACKET socket path
export const SEQPACKET_SOCKET_PATH = '/tmp/seqpacket_socket';

// RTP fixed header (RFC 3550 §5.1) https://www.rfc-editor.org/rfc/rfc3550#section-5.1
export const RTP_VERSION = 2;
export const RTP_HEADER_SIZE = 12;
export const RTP_MAX_SEQUENCE_NUMBER = 65536; // 16-bit sequence numbers wrap at 2^16
export const RTP_MAX_CSRC_COUNT = 15; // CC is a 4-bit field
export const RTP_CSRC_ENTRY_SIZE = 4;

// Default ports and dynamic payload types
export const DEFAULT_RTP_PORT = 5004;
export const DEFAULT_SRTP_PORT = 5006;
export const DEFAULT_T140_PAYLOAD_TYPE = 96; // text/t140
export const DEFAULT_FEC_PAYLOAD_TYPE = 97;  // ulpfec
export const DEFAULT_RED_PAYLOAD_TYPE = 98;  // text/red

// text/t140 (RFC 4103) https://www.rfc-editor.org/rfc/rfc4103
export const T140_CLOCK_RATE = 1000;       // §3: "A clock frequency of 1000 Hz MUST be used"
export const DEFAULT_CHAR_RATE_LIMIT = 30; // §6: default "cps"
// Buffering interval while text flows. §5.1 recommends 300 ms; 100 ms trades bandwidth for latency.
export const SEND_INTERVAL_MS = 100;
export const IDLE_THRESHOLD_MS = 300;      // §5.1: no text for longer than this = idle period
export const BACKSPACE = '\u0008';         // T.140 erases the previous character with BS

// Redundancy, text/red (RFC 2198 §3 as used by RFC 4103 §4)
// https://www.rfc-editor.org/rfc/rfc2198#section-3
export const DEFAULT_REDUNDANCY_LEVEL = 2;     // RFC 4103 §4: two redundant generations
export const RED_MAX_BLOCK_LENGTH = 1023;      // block length is a 10-bit field
export const RED_MAX_TIMESTAMP_OFFSET = 16383; // 14-bit field; older blocks MUST NOT be sent

// Generic forward error correction (RFC 5109) https://www.rfc-editor.org/rfc/rfc5109#section-7
export const DEFAULT_FEC_GROUP_SIZE = 3; // media packets protected by one FEC packet
export const FEC_MAX_GROUP_SIZE = 16;    // §7.4: the mask is 16 bits when L = 0
export const FEC_HEADER_SIZE = 10;       // §7.3
export const FEC_LEVEL_HEADER_SIZE = 4;  // §7.4: protection length (16) + mask (16)

// Character rate limiting (token bucket)
export const TOKEN_REFILL_RATE_DIVISOR = 1000; // characters per second -> per millisecond
export const MIN_TOKEN_BUCKET_VALUE = 1;
export const MIN_TOKENS_PER_STREAM = 1;

// Stream multiplexing (library convention, not part of RFC 4103)
export const INITIAL_CSRC_ID = 1;
export const MULTIPLEX_STREAM_DELIMITER = '\x1E'; // ASCII Record Separator after the stream id
export const METADATA_PACKET_PREFIX = 'MD:';      // marks a JSON metadata packet
export const DEFAULT_METADATA_PAYLOAD_TYPE = 99;  // not the text/t140 PT, so receivers drop it
export const MAX_METADATA_PAYLOAD_SIZE = 1200;    // keeps a metadata packet under a typical UDP MTU

// SRTP key derivation (RFC 3711 §8.2) https://www.rfc-editor.org/rfc/rfc3711#section-8.2
export const SRTP_MASTER_KEY_SIZE = 16;      // 128-bit master key
export const SRTP_MASTER_SALT_SIZE = 14;     // 112-bit master salt
export const PBKDF2_TOTAL_DERIVED_SIZE = 30; // key + salt
export const PBKDF2_ITERATIONS = 600000;     // OWASP 2023 minimum for PBKDF2-HMAC-SHA256
export const SRTP_AEAD_SALT_SIZE = 12;       // 96-bit salt for AES-GCM (RFC 7714 §8.1)

// DTLS-SRTP key management (RFC 5764) https://www.rfc-editor.org/rfc/rfc5764
export const DTLS_HANDSHAKE_TIMEOUT_MS = 10000;
// First byte of a packet tells DTLS records apart from (S)RTP on one port (RFC 5764 §5.1.2)
export const DTLS_RECORD_FIRST_BYTE_MIN = 20;
export const DTLS_RECORD_FIRST_BYTE_MAX = 63;
export const RTP_FIRST_BYTE_MIN = 128;
export const RTP_FIRST_BYTE_MAX = 191;
