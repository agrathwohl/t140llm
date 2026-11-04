# t140llm Bugs, Mistakes & Errors Audit

**Date:** 2026-02-22
**Scope:** All 35 source files in `src/`, 16 test files in `tests/`
**Version:** 0.0.18

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 6 |
| Medium | 7 |
| Low | 5 |
| **Total** | **20** |

---

## Critical Severity

### B1. Module-Level Side Effect: WebSocket Server Starts on Import (CRITICAL)

**File:** `src/index.ts` line 39
**Type:** Design bug

```typescript
const wss = createWebSocketServer();
```

Importing any symbol from `t140llm` — even just `createRtpPacket` — triggers `createWebSocketServer()`, which **opens a WebSocket server on a network port as a side effect of the import statement**.

**Impact:**
- Any consumer gets an unintended WebSocket server listening on a port
- Port conflicts crash the process if multiple modules import `t140llm`
- Breaks tree-shaking — bundlers cannot eliminate the side effect
- `index.d.ts` exports `wss` as a public variable, exposing the leaked server

**Reproduction:**
```typescript
import { createRtpPacket } from 't140llm'; // WebSocket server now running
```

**Fix:**
Remove the module-level invocation. Export `createWebSocketServer` as a function consumers call explicitly:
```typescript
// Remove: const wss = createWebSocketServer();
// Keep: export { createWebSocketServer } from './transport';
```

---

### B2. LSB Steganography Length Encoding Truncated to 1 Byte (CRITICAL)

**File:** `src/steganography/steg-transport.ts` lines 167–170 (encode), 186–189 (decode)
**Type:** Logic bug

The LSB encoding stores the data length in the first 32 bits of the cover, but the bit extraction loop uses `i % 8`:

```typescript
// Encode length (supposed to be 32-bit, but only uses bits 0-7)
for (let i = 0; i < 32; i++) {
  const bit = (data.length >> (i % 8)) & 1;  // BUG: i % 8 wraps every 8 bits
  cover[i] = (cover[i] & 0xFE) | bit;
}
```

Because `i % 8` wraps at 8, bits 8–31 are copies of bits 0–7. The decode reads the same pattern and recovers only the lowest byte of the length.

**Impact:**
- Maximum data size is 255 bytes, not the expected 4 GB (2^32 - 1)
- Data larger than 255 bytes is silently truncated on decode
- No error thrown — decoded data appears to succeed but is corrupted

**Fix:**
Remove the modulo:
```typescript
const bit = (data.length >> i) & 1;  // Use i directly, not i % 8
```

---

## High Severity

### B3. Race Condition: Async Constructor Initialization (HIGH)

**File:** `src/steganography/steg-transport.ts` lines 37–44
**Type:** Race condition

When `encodeMode === 'llm'`, the constructor fires an async LLM API call to generate the encoding function. But `send()` can be called before the async call completes, at which point `this.encodeFunction` is `undefined`.

```typescript
constructor(config: StegConfig) {
  if (config.encodeMode === 'llm') {
    // Async! No await possible in constructor
    this.generateAlgorithm(config.prompt).then(fn => {
      this.encodeFunction = fn;  // Set later
    });
  }
}

send(data: Buffer) {
  const encoded = this.encodeFunction(data);  // undefined if LLM hasn't responded
}
```

**Impact:**
- `TypeError: this.encodeFunction is not a function` on early send
- Non-deterministic — depends on LLM response latency
- No `ready` event or promise to await initialization

**Fix:**
Use a factory pattern instead of constructor async:
```typescript
static async create(config: StegConfig): Promise<StegTransport> {
  const transport = new StegTransport(config);
  if (config.encodeMode === 'llm') {
    transport.encodeFunction = await transport.generateAlgorithm(config.prompt);
  }
  return transport;
}
```

---

### B4. FEC Mask Breaks for Groups Larger Than 30 Packets (HIGH)

**File:** `src/rtp/t140-rtp-transport.ts` line ~294
**Type:** Arithmetic precision bug

The FEC recovery bitmask is computed using `Math.pow()`:

```typescript
const mask = Math.pow(2, fecGroupSize) - 1;
```

JavaScript `Number` uses 64-bit IEEE 754 doubles, which have 53 bits of mantissa precision. For `fecGroupSize > 30`, `Math.pow(2, 31)` = `2147483648` is fine, but `Math.pow(2, 53)` loses precision and `Math.pow(2, 64) - 1` does **not** equal `2^64 - 1`.

**Impact:**
- FEC recovery fails silently for large group sizes
- Corrupted bitmask means wrong packets are XOR'd during recovery

**Fix:**
Use BigInt or bitwise shift (for sizes ≤ 31):
```typescript
const mask = (1 << fecGroupSize) - 1;  // Correct for fecGroupSize <= 31
// OR for larger: const mask = (1n << BigInt(fecGroupSize)) - 1n;
```

---

### B5. FEC Header Stores Only First Packet's Metadata (HIGH)

**File:** `src/rtp/t140-rtp-transport.ts` lines 284–287
**Type:** RFC 5109 non-compliance

The FEC header extension stores the timestamp and length from only the first packet in the group, instead of XOR'ing all packets' values as required by RFC 5109:

```typescript
// Only uses fecGroup[0], should XOR all packets
fecHeader.writeUInt32BE(fecGroup[0].timestamp, 4);
fecHeader.writeUInt16BE(fecGroup[0].payload.length, 10);
```

**Impact:**
- FEC recovery produces incorrect timestamps and lengths
- Receivers cannot properly reconstruct lost packets
- Protocol non-compliance with RFC 5109 §7

**Fix:**
XOR all values in the group:
```typescript
let tsRecovery = 0;
let lenRecovery = 0;
for (const pkt of fecGroup) {
  tsRecovery ^= pkt.timestamp;
  lenRecovery ^= pkt.payload.length;
}
fecHeader.writeUInt32BE(tsRecovery, 4);
fecHeader.writeUInt16BE(lenRecovery, 10);
```

---

### B6. Config Merging Uses `||` Instead of `??` — Falsy Values Overridden (HIGH)

**File:** `src/rtp/t140-rtp-transport.ts` lines 151–163
**Type:** Logic bug

Configuration defaults use the `||` operator, which treats `0`, `false`, and `''` as falsy:

```typescript
this.payloadType = config.payloadType || DEFAULT_PAYLOAD_TYPE;  // 0 → DEFAULT
this.ssrc = config.ssrc || generateSecureSSRC();                // 0 → random
```

**Impact:**
- `payloadType: 0` is silently replaced with the default (valid PT 0 = PCMU audio per RFC 3551)
- `ssrc: 0` is silently replaced with a random value
- Any falsy config value gets overridden, violating explicit user intent

**Fix:**
Use nullish coalescing:
```typescript
this.payloadType = config.payloadType ?? DEFAULT_PAYLOAD_TYPE;
this.ssrc = config.ssrc ?? generateSecureSSRC();
```

---

### B7. `index.d.ts` Severely Out of Sync with Implementation (HIGH)

**File:** `src/index.d.ts`
**Type:** Type declaration bug

The hand-maintained declaration file has extensive divergences from the actual codebase:

| Issue | Detail |
|-------|--------|
| **Missing exports** | T140RtpMultiplexer, demultiplexStreams, processAIStreamToMultiplex, ErrorFactory, T140RtpError, generateSecureSSRC, all attach* helpers, all steganography types, ProcessorOptions, LLMMetadata |
| **Wrong signatures** | `createSrtpKeysFromPassphrase` missing `salt` parameter |
| **Wrong return types** | `processAIStream` declared `void`, actually returns `WebSocket.Server` |
| **Stale exports** | `wss` variable (the module-level side effect from B1) |

**Impact:**
- TypeScript consumers get wrong type information, leading to runtime errors
- Missing types force consumers to use `any` or create their own declarations
- Wrong function signatures cause compile-time-correct code that fails at runtime

**Fix:**
Generate declarations automatically via `tsc --declaration` and delete the hand-maintained file, or bring it fully into sync.

---

### B8. Pre-Existing LSP Type Errors in Source and Tests (HIGH)

**Files:** `src/rtp/t140-rtp-transport.ts`, multiple test files
**Type:** Type errors

The LSP reports **persistent type errors** in the codebase that exist independently of any changes:

**Source code errors (t140-rtp-transport.ts):**
- `RtpPacket` named import doesn't exist on `werift-rtp` — should be default import
- `SrtpSession` constructor called with 1 arg, expects 2
- `SrtpSession.encrypt` property doesn't exist (API mismatch with werift-rtp version)

**Test code errors:**
- `processing-functions.test.ts`: Accesses `private` properties `remoteAddress`, `remotePort` (4 locations)
- `integration.test.ts`: `Socket | TransportStream` union lacks `.write()` and `.end()` (4 locations)
- `t140-rtp-transport.test.ts`: Accesses `private` properties (2 locations)
- `t140-rtp-transport-multiplex.test.ts`: Assigns to read-only `createSocket` property

**Impact:**
- Source code may not actually compile correctly with strict settings
- Tests accessing private properties will break if visibility changes
- werift-rtp API mismatch means SRTP encryption may silently fail at runtime

---

## Medium Severity

### B9. RTP Timestamp Never Wraps at 32-bit Boundary (MEDIUM)

**File:** `src/rtp/t140-rtp-transport.ts` line ~580
**Type:** Protocol non-compliance (RFC 3550)

The RTP timestamp increments monotonically but never wraps at 2^32:

```typescript
this.timestamp += increment;  // Grows forever, no modulo
```

Per RFC 3550 §5.1, the timestamp is a 32-bit unsigned integer that wraps naturally.

**Impact:**
- After extended sessions, `timestamp` exceeds 32-bit range
- JavaScript Number handles this without overflow but the value written to the 4-byte RTP header field wraps implicitly via `Buffer.writeUInt32BE()` — so the **wire format** is correct, but internal comparisons and FEC calculations using the pre-wrap value will be wrong

**Fix:**
```typescript
this.timestamp = (this.timestamp + increment) >>> 0;  // Force 32-bit unsigned
```

---

### B10. Metadata Overwrites: Only Last Match Preserved (MEDIUM)

**File:** `src/utils/extract-text.ts` lines 19–99
**Type:** Logic bug

The metadata extraction checks multiple patterns sequentially. Each matching pattern **overwrites** the previous:

```typescript
if (chunk.tool_calls) { result.metadata = { type: 'tool_call', ... }; }
if (chunk.reasoning) { result.metadata = { type: 'reasoning', ... }; }
// If both exist, only 'reasoning' is returned
```

**Impact:**
- When a chunk contains both tool calls and reasoning, only the last-checked type survives
- Metadata loss is silent — no indication that earlier matches were discarded
- Provider-specific chunks with multiple metadata fields lose data

**Fix:**
Accumulate metadata into an array:
```typescript
result.metadata = [];
if (chunk.tool_calls) { result.metadata.push({ type: 'tool_call', ... }); }
if (chunk.reasoning) { result.metadata.push({ type: 'reasoning', ... }); }
```
Note: This is a breaking API change. If single-metadata is intentional, document the priority order explicitly.

---

### B11. toString() Fallback Produces Garbage Output (MEDIUM)

**File:** `src/utils/extract-text.ts` lines 155–157
**Type:** Logic bug

The final fallback in text extraction calls `chunk.toString()`:

```typescript
// After all specific checks fail
return { text: chunk.toString(), metadata: null };
```

For objects, `toString()` produces `"[object Object]"` — which is then transmitted as T.140 real-time text.

**Impact:**
- Garbled text sent over RTP to receiving endpoints
- Silent corruption — no error raised, no indication of failure
- Downstream receivers display literal `[object Object]`

**Fix:**
Return empty string or throw:
```typescript
if (typeof chunk === 'string') return { text: chunk, metadata: null };
if (typeof chunk === 'object') return { text: '', metadata: null };
throw new Error(`Cannot extract text from chunk type: ${typeof chunk}`);
```

---

### B12. CSRC Parsing Reads Headers but Never Extracts Payload (MEDIUM)

**File:** `src/utils/demultiplex-streams.ts`
**Type:** Incomplete implementation

When `useCSRC` mode is enabled, the demultiplexer reads CSRC fields from the RTP header but the code path that should extract and process the text payload from the packet body appears incomplete. A comment in the code suggests this:

```typescript
// skip RTP header processing for this example
```

**Impact:**
- CSRC-based demultiplexing reads the stream ID correctly but drops the actual text
- Multiplexed streams using CSRC mode lose all data after the demultiplexer

**Fix:**
Complete the implementation to extract payload after the dynamic header:
```typescript
const headerSize = 12 + (csrcCount * 4);
const payload = packet.slice(headerSize);
```

---

### B13. Stream ID Parsing Breaks on Colons in Content (MEDIUM)

**File:** `src/utils/demultiplex-streams.ts` line ~133
**Type:** Protocol ambiguity

Prefix-based stream identification splits on the first colon:

```typescript
const delimiterIndex = text.indexOf(':');
const streamId = text.substring(0, delimiterIndex);
const content = text.substring(delimiterIndex + 1);
```

**Impact:**
- Stream IDs containing colons break parsing (unlikely but unvalidated)
- Text content starting with `ID:` patterns could be misinterpreted as stream prefixes
- No escaping mechanism exists

**Fix:**
Use length-prefixed encoding or a unique delimiter sequence:
```typescript
// Length-prefixed: "3:foo" means stream ID "foo"
// Or use a delimiter unlikely in content: "\x1E" (ASCII Record Separator)
```

---

### B14. bufferLock in WebSocket Processor Provides No Protection (MEDIUM)

**File:** `src/processors/process-ai-stream.ts` line ~55
**Type:** Incorrect concurrency pattern

A `bufferLock` boolean is used as a synchronous mutex:

```typescript
let bufferLock = false;
// ...
if (!bufferLock) {
  bufferLock = true;
  // process buffer
  bufferLock = false;
}
```

Node.js is single-threaded with cooperative multitasking. Synchronous code cannot be interrupted, so this lock is redundant for synchronous operations. If the intent is to guard against **re-entrancy during async operations**, a boolean flag doesn't work because the event loop can resume other handlers between `await` points.

**Impact:**
- False sense of thread safety
- If async operations are added inside the guarded section, the lock will fail silently

**Fix:**
Either remove the lock (if operations are purely synchronous) or use a proper async mutex (e.g., `p-queue` or `async-mutex`).

---

### B15. Duplicate RTP Packet Creation When FEC Enabled (MEDIUM)

**File:** `src/rtp/t140-rtp-transport.ts` lines 472–479 vs 522–525
**Type:** Redundant operation

When FEC is enabled, `sendText()` creates the RTP packet twice — once for the FEC group accumulation and again for the actual send. The duplicate uses slightly different parameters.

**Impact:**
- Wasted computation (double packet creation)
- If parameters diverge, the FEC packet differs from the sent packet, breaking FEC recovery
- State mutations (sequence number increment) may apply twice

**Fix:**
Create the packet once and use the same instance for both FEC accumulation and sending.

---

## Low Severity

### B16. Address Validation Regex Misses Valid Addresses (LOW)

**File:** `src/rtp/t140-rtp-transport.ts` lines 130–134
**Type:** Overly restrictive validation

The address regex validates only dotted-quad IPv4 and multi-segment DNS names:

```typescript
const addressRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
```

**Missing:**
- IPv6 addresses (e.g., `::1`, `fe80::1`)
- Single-segment hostnames (e.g., `localhost`)
- Bracketed IPv6 (e.g., `[::1]`)

**Impact:**
- `localhost` is rejected — common in development
- IPv6-only environments cannot use the library

---

### B17. Deprecated Model Reference Makes Feature Non-Functional (LOW)

**File:** `src/steganography/steg-transport.ts` line ~223
**Type:** Stale reference

The LLM algorithm generation prompt references `text-davinci-003`, which was decommissioned by OpenAI in January 2024.

**Impact:**
- The `llm` encode mode is non-functional
- Would produce an API error if activated

---

### B18. WebSocket Server Timestamp Never Wraps (LOW)

**File:** `src/transport/websocket-server.ts` line ~85
**Type:** Same class as B9

The WebSocket server's internal RTP timestamp counter increments without wrapping. Same issue as B9 but in a different file.

---

### B19. Silent Steg Fallback Sends Unencoded Data (LOW)

**File:** `src/steganography/steg-transport.ts` line ~66
**Type:** Silent failure

When steganographic encoding fails (e.g., cover media too small, algorithm error), the transport falls back to sending the raw, unencoded data with only a `console.error`:

```typescript
try {
  encoded = this.encode(data, cover);
} catch (e) {
  console.error('Encoding failed, sending raw');
  encoded = data;  // Sends unhidden data
}
```

**Impact:**
- Data that should be hidden is sent in plaintext
- Security property silently violated
- No way for callers to detect the fallback

---

### B20. Test Files Have Pre-Existing Type Errors (LOW)

**Files:** Multiple test files (see B8 for details)
**Type:** Type errors in tests

6 test files have persistent TypeScript errors:
- Accessing private class members directly
- Type mismatches on union types
- Assigning to read-only properties
- Wrong mock return types

**Impact:**
- Tests may not compile under `strict` mode
- Tests may pass via `jest` (which transpiles separately) while hiding real type bugs
- Refactoring safety is reduced — type system can't catch test breakage

---

*Generated by codebase audit, 2026-02-22*
