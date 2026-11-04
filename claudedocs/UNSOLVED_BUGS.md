# t140llm Unsolved Bugs Report

This document catalogs all bugs and issues identified during the exhaustive code analysis of the t140llm library (v0.0.14) that remain unresolved. The analysis was conducted on January 15, 2026.

## Summary

| Severity | Count | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 5 | 3 | 2 |
| High | 9 | 2 | 7 |
| Medium | 8 | 2 | 6 |
| Low | 5 | 1 | 4 |
| **Total** | **27** | **8** | **19** |

### Fixed Issues
- **existingTransport bug** - Fixed in all 4 processor source files AND the test mock (`src/__mocks__/index.ts`):
  - `src/processors/process-ai-stream-to-rtp.ts` - Added `attachStreamToRtpTransport` helper
  - `src/processors/process-ai-stream-to-srtp.ts` - Added `attachStreamToSrtpTransport` helper
  - `src/processors/process-ai-stream-to-direct-socket.ts` - Added `attachStreamToDirectSocketTransport` helper
  - `src/processors/process-ai-stream.ts` - Added `attachStreamToWebSocket` helper
  - `src/__mocks__/index.ts` - Updated all mock implementations to support existingTransport/existingConnection parameters
  - 20 tests added in `tests/existing-transport.test.ts` validating the fix
- **FEC XOR bug** - Fixed in `t140-rtp-transport.ts` (corrected bitwise XOR for RFC 5109 compliance)
- **SrtpConfig validation** - Fixed by adding `validateSrtpConfig()` function that throws on invalid config:
  - `src/processors/process-ai-stream-to-srtp.ts` - Added validation in `processAIStreamToSrtp` and `createT140SrtpTransport`
  - `src/__mocks__/index.ts` - Updated mock to match validation behavior
  - 10 tests added in `tests/srtp.test.ts` validating error cases and valid configs
- **Sequence number wraparound** - Fixed in `src/transport/websocket-server.ts`:
  - Changed `sequenceNumber += 1` to `sequenceNumber = (sequenceNumber + 1) % RTP_MAX_SEQUENCE_NUMBER`
  - Now properly wraps at 16-bit boundary (65536) per RTP specification
- **RTP header CSRC parsing** (RFC 3550) - Fixed in `src/utils/demultiplex-streams.ts`:
  - Now calculates dynamic header size: `12 + (csrcCount * 4)` instead of hardcoded 12 bytes
  - Properly extracts CSRC count using bitwise AND (`& 0x0F`) per RFC 3550
- **FEC header size** (RFC 5109) - Fixed in `src/utils/constants.ts`:
  - Changed `FEC_HEADER_EXTENSION_SIZE` from 16 to 12 bytes per RFC 5109
- **Bitwise operations lint rule** - Removed `no-bitwise` restriction in `tslint.json`:
  - Bitwise operations are essential for protocol implementations (RTP/SRTP/FEC)
- **Backspace processing Unicode** (ITU-T T.140/RFC 4103) - Fixed in `src/utils/backspace-processing.ts`:
  - Now uses `Intl.Segmenter` for proper grapheme cluster handling
  - Correctly handles emoji (including ZWJ sequences), combining characters, and complex grapheme clusters
  - Updated `package.json` to require Node >= 16.0.0 for `Intl.Segmenter` support

---

## Critical Severity

### 1. Math.random() Used for Security-Critical Operations
**Files:** `src/steganography/steg-transport.ts`
**Lines:** 69, 154-155

**Description:**
The steganography module uses `Math.random()` for both cover media selection and cryptographic seed generation. `Math.random()` is not cryptographically secure and produces predictable sequences that attackers can exploit.

**Impact:**
- Attackers can predict which cover media will be used
- Attackers can predict data placement within steganographic cover
- Completely defeats the security model of the steganography feature

**Recommendation:**
Replace with `crypto.randomBytes()` from Node.js crypto module:
```typescript
import { randomBytes } from 'crypto';
const index = randomBytes(4).readUInt32BE(0) % coverMedia.length;
```

---

### 2. Silent Fallback from TLS to Non-Secure WebSocket
**File:** `src/transport/websocket-server.ts`
**Lines:** 25-47

**Description:**
When TLS certificate loading fails (wrong path, invalid format, permissions), the WebSocket server silently falls back to unencrypted WS instead of WSS. Only a `console.warn` is emitted.

**Impact:**
- Applications expecting secure connections transmit data in plaintext
- Security contract violated without caller notification
- Potential for man-in-the-middle attacks

**Recommendation:**
Throw an exception on TLS setup failure:
```typescript
if (options.tls) {
  try {
    // Load certificates
  } catch (error) {
    throw new Error(`TLS setup failed: ${error.message}. Refusing to start insecure server.`);
  }
}
```

---

## High Severity

### 5. charRateLimit Inherited but Not Implemented in SRTP
**File:** `src/interfaces/srtp-config.interface.ts`
**Line:** 6

**Description:**
`SrtpConfig` extends `RtpConfig` which includes `charRateLimit`, but SRTP processor doesn't implement rate limiting. Configuration is silently ignored.

**Impact:**
- Applications expecting rate limiting get none
- Potential network policy violations
- SLA contract violations

**Recommendation:**
Either implement rate limiting in SRTP processor or explicitly exclude `charRateLimit` from `SrtpConfig`.

---

### 6. UDP Socket Created Without Error Handler
**File:** `src/steganography/transport-factory.ts`
**Lines:** 14-27

**Description:**
`createDefaultTransport` creates a UDP socket without an error event handler. Unhandled socket errors crash the Node.js process.

**Impact:**
- Application crashes on network errors
- No graceful error recovery possible

**Recommendation:**
Add error handler to factory-created sockets:
```typescript
const socket = dgram.createSocket('udp4');
socket.on('error', (err) => {
  // Handle or propagate error
});
```

---

### 8. SEQPACKET Socket Connection Never Verified
**File:** `src/transport/websocket-server.ts`
**Line:** 52

**Description:**
Socket connection created without verifying success or handling errors. Writes attempted before connection established.

**Impact:**
- Silent failures if socket path invalid
- Data loss without notification

**Recommendation:**
Wait for 'connect' event before writing:
```typescript
socket.on('connect', () => { isConnected = true; });
socket.on('error', (err) => { /* notify WebSocket client */ });
```

---

### 9. Certificate File Type Casting Without Validation
**File:** `src/transport/websocket-server.ts`
**Lines:** 31-36

**Description:**
Certificate files read without specifying encoding or validating content format. `fs.readFileSync()` returns Buffer by default, but PEM format requires string.

**Impact:**
- Potential certificate loading failures
- Type mismatches with https.createServer()

**Recommendation:**
Specify encoding and validate:
```typescript
const cert = fs.readFileSync(options.tls.cert, 'utf8');
if (!cert.includes('-----BEGIN CERTIFICATE-----')) {
  throw new Error('Invalid certificate format');
}
```

---

### 10. Dynamic require() Breaks Module Encapsulation
**File:** `src/steganography/transport-factory.ts`
**Lines:** 61-63

**Description:**
Uses `require()` at runtime to import `processAIStreamToRtp`, supposedly to avoid circular dependencies. This is fragile and breaks static analysis.

**Impact:**
- Bundlers cannot analyze dependencies
- Refactoring breaks silently
- Type safety compromised

**Recommendation:**
Restructure modules to eliminate circular dependency, or pass function as parameter.

---

### 11. processAIStreamToStegRtp Ignores Return Value
**File:** `src/steganography/transport-factory.ts`
**Line:** 68

**Description:**
Function calls `processAIStreamToRtp` but discards return value, returning pre-created transport instead.

**Impact:**
- Potential disconnect between returned transport and attached stream
- Unexpected behavior if processAIStreamToRtp modifies transport

**Recommendation:**
Use the return value from processAIStreamToRtp or document why it's intentionally ignored.

---

### 12. Transport Factory Ignores customTransport Config
**File:** `src/steganography/transport-factory.ts`
**Lines:** 45-54

**Description:**
When creating steganography wrapper, the customTransport field precedence is unclear. Wrapped transport may not be properly set in returned config.

**Impact:**
- Custom transports may be silently ignored
- Steganography wrapper potentially not applied

**Recommendation:**
Clarify and document transport wrapping precedence.

---

## Medium Severity

### 14. Backspace Buffer Never Flushed on Stream Close
**Files:** All 4 processor files

**Description:**
When streams end, any partial text remaining in the backspace processing buffer is silently discarded.

**Impact:**
- Final characters of messages may be lost
- Data loss without notification

**Recommendation:**
Flush buffer before closing:
```typescript
stream.on('end', () => {
  if (textBuffer) {
    transport.sendText(textBuffer);
  }
  transport.close();
});
```

---

### 15. Metadata Extraction Overwrites Previous Metadata
**File:** `src/utils/extract-text.ts`
**Lines:** 15-78

**Description:**
Multiple metadata detection patterns overwrite each other. Only the last detected metadata type is returned, losing concurrent metadata.

**Impact:**
- Metadata loss when multiple types present
- Unpredictable behavior based on check order

**Recommendation:**
Accumulate metadata into array or merge into combined object.

---

### 16. Text Extraction Short-Circuits on First Match
**File:** `src/utils/extract-text.ts`
**Lines:** 85-162

**Description:**
Early returns prevent checking alternative text locations. Check order creates implicit priority that may not match API semantics.

**Impact:**
- Wrong text field used if API has multiple
- Brittleness if chunk formats evolve

**Recommendation:**
Document priority order or check all locations and merge.

---

### 17. Fallback toString() Produces Garbage Output
**File:** `src/utils/extract-text.ts`
**Lines:** 159-162

**Description:**
Final fallback calls `chunk.toString()` which may produce "[object Object]" or other non-text content.

**Impact:**
- Garbage transmitted over RTP as T.140 text
- Silent format mismatch

**Recommendation:**
Throw error instead of using toString() fallback, or return empty string with warning.

---

### 18. Stream Identifier Parsing Ambiguous with Colons
**File:** `src/utils/demultiplex-streams.ts`
**Lines:** 96-104

**Description:**
Uses first colon as delimiter between stream ID and text. Breaks if stream IDs or text contain colons.

**Impact:**
- Parsing errors with colon-containing content
- Protocol ambiguity

**Recommendation:**
Use length-prefixed encoding or different delimiter.

---

### 19. Metadata JSON Not Size-Limited in RTP Packet
**File:** `src/processors/process-ai-stream-to-direct-socket.ts`
**Lines:** 53-59

**Description:**
Metadata serialized to JSON without size validation. Large metadata can exceed MTU, causing fragmentation.

**Impact:**
- Packet fragmentation
- Potential packet loss
- Receiver parsing issues

**Recommendation:**
Add length field and enforce maximum metadata size.

---

## Low Severity

### 21. Console Logging Instead of Proper Error Propagation
**Files:** `src/steganography/steg-transport.ts`, `src/transport/websocket-server.ts`

**Description:**
Errors logged to console instead of emitting events or throwing exceptions.

**Impact:**
- Errors lost if stdout redirected
- Cannot be handled by calling code
- Difficult to test

**Recommendation:**
Use EventEmitter for error propagation or proper logging framework.

---

### 22. close() Method Optional in TransportStream Interface
**File:** `src/interfaces/transport-stream.interface.ts`
**Line:** 16

**Description:**
`close()` marked optional, meaning some transports may not implement cleanup.

**Impact:**
- Resource leaks possible
- Callers must check if close exists

**Recommendation:**
Make close() required or use disposable pattern.

---

### 23. TransportStream Lacks Backpressure Handling
**File:** `src/interfaces/transport-stream.interface.ts`
**Lines:** 9-11

**Description:**
`send()` callback only handles errors, doesn't support backpressure signaling.

**Impact:**
- Memory exhaustion for high-volume input
- No way to pause input when buffer full

**Recommendation:**
Return boolean from send() or support 'drain' event.

---

### 25. SRTP Profile Parameter Not Validated
**File:** `src/interfaces/srtp-config.interface.ts`
**Line:** 8

**Description:**
`profile` accepts any number without validation against valid SRTP profile values.

**Impact:**
- Runtime errors with invalid profiles
- Potential security issues

**Recommendation:**
Use enum or branded type restricting to valid SRTP profiles.

---

## Architectural Concerns

### Code Duplication Across Processor Files
All four processor files (`process-ai-stream.ts`, `process-ai-stream-to-rtp.ts`, `process-ai-stream-to-srtp.ts`, `process-ai-stream-to-direct-socket.ts`) contain 200+ lines of duplicated stream processing logic including:
- Backspace processing setup
- Metadata handling
- Stream event handlers
- Text buffer management

**Recommendation:**
Extract common logic into shared utility:
```typescript
// src/utils/stream-processor.ts
export function attachStreamProcessor(stream, config) {
  // Common stream processing logic
}
```

### Parameter Ordering Inconsistency
Function signatures vary inconsistently:
- `processAIStreamToRtp(stream, address, port, config, existing)`
- `processAIStreamToSrtp(stream, address, config, port, existing)`
- `processAIStreamToDirectSocket(stream, socketPath, config, existing)`
- `processAIStream(stream, url, options, existing)`

**Recommendation:**
Standardize to `(stream, destination, config, existing)` pattern (breaking change).

---

## Testing Recommendations

1. ~~**Add Unicode tests** for backspace processing with emoji and combining characters~~ - Implementation fixed; recommend adding tests to validate grapheme cluster handling
2. **Add negative tests** for TLS fallback behavior
3. **Add CSRC-based demultiplexing tests** with various CSRC counts

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-15 | 1.0 | Initial analysis and bug catalog |
| 2026-01-16 | 1.1 | Fixed: sequence wraparound, CSRC parsing, FEC header size, no-bitwise rule, Unicode backspace |
