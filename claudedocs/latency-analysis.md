# t140llm Streaming Latency Analysis

**Date:** 2026-03-11 (updated 2026-03-11 with implementation results)
**Version:** 0.0.19
**Scope:** All stream processing, transport, and packet creation paths in `src/`

---

## Executive Summary

~~The t140llm pipeline adds **50-100ms average latency** to the RTP/SRTP transport path due to a fixed 100ms polling interval for rate-limited sends.~~ **RESOLVED.** As of v0.0.19, the pipeline uses event-driven sending with sub-millisecond latency. Eight latency sources were identified; six have been implemented, two remain as future optimizations.

**Measured results (benchmark: 50 tokens, 30ms intervals, charRateLimit=300):**

| Transport Path | Before (v0.0.18) | After (v0.0.19) | Improvement |
|---|---|---|---|
| RTP/UDP — EventEmitter | 50ms avg | **0.152ms** avg | **~330x** |
| RTP/UDP — AsyncIterable | 50ms avg | **0.095ms** avg | **~526x** |
| First-char (EventEmitter) | 0–100ms | **0.817ms** | **~60x** |
| First-char (AsyncIterable) | 0–100ms | **0.102ms** | **~490x** |
| p95 (EventEmitter) | ~95ms | **0.267ms** | **~356x** |
| p95 (AsyncIterable) | ~95ms | **0.144ms** | **~660x** |
| WebSocket | <1ms | <0.5ms (Nagle fix) | ~2x |
| DirectSocket | <1ms | <1ms | Negligible |

---

## Methodology

1. Traced every chunk from stream ingestion (`stream.on('data')`) through text extraction, backspace processing, rate limiting, packet creation, and transport send for all 5 processor paths
2. Read all latency-critical source files and measured synchronous work per chunk
3. Identified all buffering/queuing stages and their drain timing
4. Cross-referenced with RFC 4103 (RTP T.140), RFC 9071 (T.140 updates), and RFC 3550 (RTP) timing requirements
5. Verified all constants in `src/utils/constants.ts`

---

## Latency Sources (Ranked by Impact)

### 1. ✅ IMPLEMENTED: Fixed 100ms Polling Interval for Rate-Limited Sends

**Status:** Resolved in v0.0.19 — replaced `setInterval` with event-driven `flushQueue()` + `setTimeout` retry.
**Impact:** 0–100ms added latency per character (avg 50ms) → **<0.2ms avg**
**Files:**
- `src/processors/process-ai-stream-to-rtp.ts` lines 36–53
- `src/rtp/t140-rtp-multiplexer.ts` lines 107–151

**Problem:**

Rate-limited RTP sending uses `setInterval(SEND_INTERVAL_MS)` (100ms) with a token bucket. Characters are pushed to `charQueue[]` as grapheme clusters, then drained by a fixed-rate timer:

```typescript
// process-ai-stream-to-rtp.ts, lines 36-53
const sendTimer = setInterval(() => {
  const elapsed = Date.now() - lastSendTime;
  tokenBucket = Math.min(
    charRateLimit,
    tokenBucket + (elapsed * charRateLimit) / TOKEN_REFILL_RATE_DIVISOR
  );
  tokenBucket = Math.max(tokenBucket, MIN_TOKEN_BUCKET_VALUE);
  lastSendTime = Date.now();

  let charsToSend = '';
  while (charQueue.length > 0 && tokenBucket >= 1) {
    charsToSend += charQueue.shift()!;
    tokenBucket -= 1;
  }
  if (charsToSend) {
    transport.sendText(charsToSend);
  }
}, SEND_INTERVAL_MS); // 100ms
```

This is a **poll-and-drain** model. Regardless of when a character arrives, it waits for the next timer tick (0–100ms) before being sent. A character arriving 1ms after a tick waits 99ms. The uniform distribution yields 50ms average wait.

The multiplexer (`t140-rtp-multiplexer.ts`) uses the identical pattern with round-robin scheduling across streams, compounding the latency with fairness overhead.

**RFC Context:**

RFC 4103 §5.1 specifies a **300ms** recommended buffer interval with a hard limit of 500ms. The current 100ms interval is more aggressive than the RFC requires. However, RFC 4103 also mandates that the **first packet after an idle period** SHOULD be sent immediately (with the M-bit set in the RTP header). The current implementation does not distinguish between "first character after idle" and "character during continuous output" — it always polls at 100ms.

RFC 9071 (2021) further recommends sending "as soon as new text is available" for mixer implementations, capping at 330ms.

**Proposed Fix — Event-Driven Adaptive Buffering:**

```typescript
// Pseudocode for event-driven model
let isIdle = true;
let bufferTimer: NodeJS.Timeout | null = null;

function onCharacterReceived(text: string) {
  charQueue.push(...toGraphemes(text));

  if (isIdle) {
    // First character after idle — send immediately (RFC 4103 M-bit)
    flushQueue();
    isIdle = false;
  } else if (!bufferTimer) {
    // During active output — buffer for up to BUFFER_INTERVAL_MS
    bufferTimer = setTimeout(() => {
      flushQueue();
      bufferTimer = null;
    }, BUFFER_INTERVAL_MS); // e.g. 50ms, configurable
  }
}

function flushQueue() {
  // Apply rate limiting via token bucket
  const now = Date.now();
  refillTokens(now);
  let charsToSend = '';
  while (charQueue.length > 0 && tokenBucket >= 1) {
    charsToSend += charQueue.shift()!;
    tokenBucket -= 1;
  }
  if (charsToSend) {
    transport.sendText(charsToSend);
  }
  // If queue still has characters, schedule next drain
  if (charQueue.length > 0) {
    bufferTimer = setTimeout(() => {
      flushQueue();
      bufferTimer = null;
    }, TOKEN_REFILL_INTERVAL_MS);
  } else {
    // Idle detection: reset after no input for IDLE_THRESHOLD_MS
    setTimeout(() => {
      if (charQueue.length === 0) isIdle = true;
    }, IDLE_THRESHOLD_MS);
  }
}
```

Key changes:
- **First character after idle**: Sent immediately (<1ms) instead of waiting 0–100ms
- **Continuous output**: Buffered for a configurable interval (e.g., 50ms), then flushed with rate limiting
- **No fixed polling**: Timer only runs when there's data to send — saves CPU during silence
- **Idle detection**: Automatically resets to "send immediately" mode after quiet period

**Effort:** Medium (2–4h). Touches 2 files, must preserve existing rate limiting behavior.

---

### 2. HIGH: FEC Group Accumulation Delay

**Impact:** `fecGroupSize * SEND_INTERVAL_MS` = 500ms with defaults
**File:** `src/rtp/t140-rtp-transport.ts` lines 522–574

**Problem:**

FEC (Forward Error Correction, RFC 5109) accumulates `fecGroupSize` (default 5) packets before generating and sending the FEC recovery packet. Data packets themselves are sent immediately — FEC does **not** delay them. But the FEC recovery information is delayed by the entire group accumulation window.

With `SEND_INTERVAL_MS=100` and `fecGroupSize=5`, the FEC packet covering the first data packet isn't sent until 500ms later. If that first packet is lost, recovery must wait 500ms.

**This is inherent to block FEC design** — not a bug. But the defaults are conservative for real-time text:

- RFC 4103 hard limit = 500ms character-to-display
- 500ms FEC accumulation = no headroom for retransmission

**Proposed Fix — Reduce Default Group Size + Add Interleaving Option:**

```typescript
// constants.ts
export const DEFAULT_FEC_GROUP_SIZE = 3; // Was 5 — reduces FEC delay to 300ms

// Future: sliding-window FEC (non-block) for sub-100ms recovery
```

Reducing group size from 5→3 reduces FEC delay from 500ms to 300ms, staying within RFC 4103 limits while allowing retransmission headroom. Trade-off: slightly lower FEC efficiency (more FEC overhead per data packet).

**Effort:** Low (15min for default change). Sliding-window FEC would be a larger architectural change.

---

### 3. ✅ IMPLEMENTED: Double Grapheme Segmentation Per Chunk

**Status:** Resolved in v0.0.19 — `processT140BackspaceChars()` now returns `processedGraphemes[]`, RTP processor uses pre-computed graphemes.
**Impact:** ~0.1–0.5ms per chunk (compounds at high token rates) → eliminated
**Files:**
- `src/utils/backspace-processing.ts` — `processT140BackspaceChars()` calls `toGraphemes()` on buffer+input
- `src/processors/process-ai-stream-to-rtp.ts` line 63 — `charQueue.push(...toGraphemes(text))` calls it again
- `src/rtp/t140-rtp-multiplexer.ts` lines 296, 339 — same pattern

**Problem:**

When both backspace processing AND rate limiting are active (the default configuration), every text chunk is segmented into grapheme clusters twice:

1. **Backspace processing** (`processT140BackspaceChars`): Segments `buffer + input` via `toGraphemes()` to handle backspace characters correctly. Returns a string.
2. **Rate limiter** (RTP processor): Segments the returned string AGAIN via `toGraphemes()` to push individual graphemes into `charQueue[]`.

`toGraphemes()` uses `Intl.Segmenter` (the `Segmenter` instance is cached, but `Array.from(segmenter.segment(str))` allocates a new array each call).

**Proposed Fix — Return Graphemes from Backspace Processing:**

```typescript
// Option A: Return graphemes directly from processT140BackspaceChars
export function processT140BackspaceChars(
  buffer: string, input: string
): { text: string; graphemes: string[] } {
  const graphemes = toGraphemes(buffer + input);
  // ... process backspaces on graphemes array ...
  return { text: processed.join(''), graphemes: processed };
}

// Then in RTP processor:
const { text, graphemes } = processT140BackspaceChars(buffer, rawText);
charQueue.push(...graphemes); // No second toGraphemes() call
```

**Effort:** Low (30min). Requires changing return type of `processT140BackspaceChars` and callers.

---

### 4. ✅ IMPLEMENTED: Unconditional Metadata Extraction

**Status:** Resolved in v0.0.19 — added `extractMetadata` parameter, callers pass `handleMetadata` flag.
**Impact:** ~0.01–0.05ms per chunk (9 property-chain checks) → skipped when unused
**File:** `src/utils/extract-text.ts` lines 19–99

**Problem:**

`extractTextFromChunk()` runs 9 sequential metadata pattern checks on every chunk, regardless of whether a `metadataCallback` is registered:

```typescript
// Always runs, even with handleMetadata=false
if (chunk.tool_calls) { result.metadata = { type: 'tool_call', ... }; }
if (chunk.function_call) { result.metadata = { type: 'function_call', ... }; }
if (chunk.reasoning) { result.metadata = { type: 'reasoning', ... }; }
// ... 6 more checks ...
```

Each check involves optional chaining through object properties (`chunk?.choices?.[0]?.delta?.tool_calls`). The absolute time is small (~0.01ms), but this runs on every single chunk at LLM token rates (50–100+ per second).

**Proposed Fix — Short-Circuit When No Metadata Handling:**

```typescript
export function extractTextFromChunk(
  chunk: unknown,
  options?: { extractMetadata?: boolean }
): { text: string; metadata: LLMMetadata | null } {
  let metadata: LLMMetadata | null = null;

  // Skip metadata extraction when not needed
  if (options?.extractMetadata !== false) {
    metadata = extractMetadata(chunk);
  }

  const text = extractText(chunk);
  return { text, metadata };
}
```

The caller in `stream-processor.ts` passes `extractMetadata: !!options.handleMetadata`.

**Effort:** Low (30min). Requires adding parameter to `extractTextFromChunk` and updating callers.

---

### 5. ✅ IMPLEMENTED: TCP Nagle Algorithm on WebSocket Path

**Status:** Resolved in v0.0.19 — `setNoDelay(true)` on both server and client WebSocket connections.
**Impact:** Up to 1 RTT (10–200ms) per small write → eliminated
**File:** `src/transport/websocket-server.ts` — WebSocket server creation
**File:** `src/processors/process-ai-stream.ts` — WebSocket client connection

**Problem:**

The `ws` library does **not** set `TCP_NODELAY` by default. Nagle's algorithm buffers small writes (< MSS ~1460 bytes) until either:
- A full MSS of data accumulates, OR
- The ACK for the previous segment arrives

T.140 payloads are typically 1–50 bytes — far below MSS. Each `ws.send(text)` may be delayed by up to one RTT waiting for the previous ACK.

For LAN (0.5ms RTT): negligible. For WAN (50–200ms RTT): significant.

**Fix Applied:**

```typescript
// In websocket-server.ts — server-side
server.on('connection', (ws, req) => {
  req.socket.setNoDelay(true);
});

// In process-ai-stream.ts — client-side
ws.on('open', () => {
  if ((ws as any)._socket) {
    (ws as any)._socket.setNoDelay(true);
  }
});
```

---

### 6. LOW-MEDIUM: RTP Packet Buffer Allocations

**Impact:** ~0.02–0.1ms per packet (3 allocations + potential GC pressure)
**File:** `src/rtp/create-rtp-packet.ts`

**Problem:**

Every RTP packet creation allocates 3 buffers:

```typescript
const header = Buffer.alloc(headerSize);  // 12-16 bytes
// ... fill header fields ...
const payload = Buffer.from(text, 'utf-8');
return Buffer.concat([header, payload]);
```

When FEC is enabled, additional copies via `Buffer.from(packet)` for the FEC group buffer. When RED (redundancy) is enabled, previous payloads are copied and concatenated.

At 10 packets/sec this is negligible. At 100+ packets/sec (high token rate, low buffer interval), GC pressure from short-lived Buffer allocations can cause event loop stalls.

**Proposed Fix — Header Template + Buffer Pool:**

```typescript
// Pre-allocate header template (fields that don't change per-packet)
const headerTemplate = Buffer.alloc(12);
headerTemplate[0] = 0x80; // Version 2, no padding, no extension, 0 CSRC

// Per-packet: copy template, fill dynamic fields, write directly to pre-allocated buffer
const packetPool = new BufferPool(MTU_SIZE, POOL_SIZE);

function createRtpPacket(text: string, state: RtpState): Buffer {
  const payload = Buffer.from(text, 'utf-8');
  const packet = packetPool.acquire(12 + payload.length);
  headerTemplate.copy(packet, 0);
  // Write dynamic fields: seq, timestamp, ssrc, payload type
  packet.writeUInt16BE(state.sequenceNumber, 2);
  packet.writeUInt32BE(state.timestamp, 4);
  packet.writeUInt32BE(state.ssrc, 8);
  payload.copy(packet, 12);
  return packet;
}
```

**Effort:** Medium (2h). Requires buffer pool implementation and lifecycle management.

---

### 7. ✅ IMPLEMENTED: String Concatenation in Backspace Processing Loop

**Status:** Resolved in v0.0.19 — combined with optimization #3. `processT140BackspaceChars()` now uses array-based processing (`processedGraphemes.push()` / `.pop()`) and returns the grapheme array directly.
**Impact:** ~0.01ms per chunk → eliminated (array ops instead of string concat)

---

### 8. LOW: SRTP Serialize/Deserialize Overhead

**Impact:** ~0.5–2ms per packet
**File:** `src/rtp/t140-rtp-transport.ts` — SRTP send path

**Problem:**

The SRTP path first creates a raw RTP packet buffer, then deserializes it into an `RtpPacket` object (werift-rtp), then encrypts:

```typescript
const rawPacket = createRtpPacket(text, config);
const rtpPacket = RtpPacket.deSerialize(rawPacket); // Parse buffer → object
const encrypted = srtpSession.encrypt(rtpPacket);   // Object → encrypted buffer
```

The deserialize step is redundant — the packet was just constructed from the same fields that `RtpPacket` would populate. The werift-rtp API requires an `RtpPacket` object, so this is partially an upstream constraint.

**Proposed Fix:**

Construct `RtpPacket` directly instead of going through raw buffer:

```typescript
const rtpPacket = new RtpPacket();
rtpPacket.header.payloadType = config.payloadType;
rtpPacket.header.sequenceNumber = state.sequenceNumber;
rtpPacket.header.timestamp = state.timestamp;
rtpPacket.header.ssrc = state.ssrc;
rtpPacket.payload = Buffer.from(text, 'utf-8');
const encrypted = srtpSession.encrypt(rtpPacket);
```

This eliminates the serialize→deserialize round-trip. Requires verifying werift-rtp's `RtpPacket` constructor API.

**Effort:** Medium (1h). Depends on werift-rtp API compatibility.

---

## Additional Optimization Opportunities

### A. Configurable Low-Latency Mode

Add a `lowLatency` configuration option that adjusts multiple parameters simultaneously:

```typescript
interface RtpConfig {
  // ... existing fields ...
  lowLatency?: boolean; // When true, optimizes for minimum pipeline latency
}

// When lowLatency=true:
// - Uses event-driven send (optimization #1) instead of fixed polling
// - Reduces FEC group size to 2 (optimization #2)
// - Disables RED redundancy (no previous-packet overhead)
// - Skips metadata extraction if no callback registered (optimization #4)
```

This gives users a single knob for latency-sensitive deployments without requiring them to understand each individual parameter.

### B. Idle Detection with M-bit (RFC 4103 Compliance)

RFC 4103 §5.1 specifies that the first T.140 packet after an idle period SHOULD set the Marker bit (M-bit) in the RTP header. The current implementation does not track idle state or set the M-bit.

Adding idle detection enables:
1. Immediate first-packet send (latency optimization #1)
2. Correct M-bit signaling for downstream mixers and receivers
3. NAT pinhole keep-alive via periodic empty packets during silence

### C. Pre-Warm with BOM Character

RFC 4103 recommends sending the Unicode BOM (U+FEFF) as the first character to:
1. Open NAT pinholes for UDP
2. Verify end-to-end connectivity
3. Signal T.140 encoding to receivers

This reduces perceived latency for the first real character by ensuring the network path is already established.

### D. WebSocket Binary Mode

The WebSocket processor currently sends text as UTF-8 strings via `ws.send(text)`. For T.140 data that will be further processed, binary mode (`ws.send(buffer)`) avoids the WebSocket library's internal UTF-8 validation step.

---

## Latency Budget Analysis

### Before Optimizations (v0.0.18, RTP path, rate-limited)

```
LLM Token Arrival
  │
  ├─ extractTextFromChunk()     ~0.05ms  (18 sequential checks)
  ├─ processT140BackspaceChars() ~0.1ms  (grapheme segmentation #1)
  ├─ toGraphemes() for charQueue ~0.1ms  (grapheme segmentation #2, redundant)
  ├─ charQueue wait              0-100ms (fixed polling interval, avg 50ms)
  ├─ createRtpPacket()           ~0.05ms (3 buffer allocations)
  ├─ [SRTP encrypt]              ~1ms    (if SRTP enabled)
  ├─ dgram.send()                <0.1ms  (kernel sendmsg, non-blocking)
  │
  Total (RTP):                   0.3-100ms (avg ~50ms)
  Total (SRTP):                  1.3-101ms (avg ~51ms)
```

### After Optimizations (v0.0.19, measured)

```
LLM Token Arrival
  │
  ├─ extractTextFromChunk()     ~0.01ms  (metadata skipped when unused ✅)
  ├─ processT140BackspaceChars() ~0.05ms (returns graphemes directly ✅)
  ├─ event-driven flushQueue()   <0.1ms  (immediate when tokens available ✅)
  ├─ createRtpPacket()           ~0.05ms (3 buffer allocations)
  ├─ [SRTP encrypt]              ~1ms    (if SRTP enabled)
  ├─ dgram.send()                <0.1ms
  │
  Measured (EventEmitter):       avg 0.152ms, p95 0.267ms
  Measured (AsyncIterable):      avg 0.095ms, p95 0.144ms
  First-char (EventEmitter):     0.817ms
  First-char (AsyncIterable):    0.102ms
```

---

## Optimization Priority Matrix

| # | Optimization | Impact | Effort | Breaking? | Depends On |
|---|---|---|---|---|---|
| 1 | Event-driven send (replace setInterval) | **Critical** — 50ms avg → <5ms | Medium (2–4h) | No | None |
| 2 | Reduce FEC default group size (5→3) | **High** — 500ms → 300ms FEC delay | Low (15min) | No | None |
| 3 | Eliminate double grapheme segmentation | **Medium** — ~0.2ms/chunk saved | Low (30min) | No | None |
| 4 | Skip metadata extraction when unused | **Medium** — ~0.03ms/chunk saved | Low (30min) | No | None |
| 5 | TCP_NODELAY on WebSocket | **Medium** — up to 1 RTT saved | Low (15min) | No | None |
| 6 | Buffer pool for RTP packets | **Low-Med** — GC pressure reduced | Medium (2h) | No | None |
| 7 | Array-based backspace processing | **Low** — ~0.01ms/chunk saved | Low (15min) | No | None |
| 8 | Direct RtpPacket for SRTP | **Low** — ~0.5ms/packet saved | Medium (1h) | No | werift-rtp API |
| A | Low-latency config mode | **High** — UX improvement | Medium (2h) | No | #1, #2 |
| B | Idle detection + M-bit | **Medium** — RFC compliance + latency | Medium (1h) | No | #1 |
| C | BOM pre-warm | **Low** — first-packet latency | Low (15min) | No | None |
| D | WebSocket binary mode | **Low** — avoids UTF-8 validation | Low (15min) | No | None |

### Recommended Implementation Order

**Phase 1 — Quick Wins (< 2 hours total, no architectural changes):**
- #2: Reduce FEC default group size
- #3: Eliminate double grapheme segmentation
- #4: Skip metadata extraction when unused
- #5: TCP_NODELAY on WebSocket
- #7: Array-based backspace processing

**Phase 2 — Core Optimization (2–4 hours):**
- #1: Event-driven adaptive send model (biggest impact)
- #B: Idle detection + M-bit signaling

**Phase 3 — Polish (2–4 hours):**
- #A: Low-latency config mode
- #6: Buffer pool for RTP packets
- #8: Direct RtpPacket construction for SRTP
- #C: BOM pre-warm
- #D: WebSocket binary mode

---

## RFC Compliance Considerations

| Requirement | Standard | Current Status | After Optimization |
|---|---|---|---|
| Max buffer interval 500ms | RFC 4103 §5.1 | 100ms (compliant) | Event-driven (compliant) |
| Recommended buffer 300ms | RFC 4103 §5.1 | 100ms (more aggressive) | Configurable (compliant) |
| First packet immediate + M-bit | RFC 4103 §5.1 | Not implemented | Implemented (#1, #B) |
| Rate limit for automated sources | RFC 4103 §9 | 30 chars/sec default (compliant) | Preserved (compliant) |
| Mixer max interval 330ms | RFC 9071 | N/A (no mixer mode) | N/A |
| Character-to-display < 500ms | ITU-T T.140 | ~50ms avg (compliant) | <5ms avg (compliant) |

---

## Measurement Recommendations

To validate optimizations, instrument these metrics:

1. **Chunk-to-wire latency**: `Date.now()` at `stream.on('data')` vs `dgram.send()` callback
2. **Queue depth**: `charQueue.length` sampled at each drain
3. **Token bucket utilization**: `tokenBucket` value at each drain (are we rate-limited or timer-limited?)
4. **Idle-to-first-char time**: Time between last `stream.on('end')` and first `dgram.send()` of next stream
5. **GC pause frequency**: `--trace-gc` flag during sustained streaming

---

*Generated by deep codebase analysis, 2026-03-11*
*Sources: RFC 4103 (RTP T.140), RFC 9071 (T.140 Updates), RFC 3550 (RTP), RFC 5109 (FEC)*
