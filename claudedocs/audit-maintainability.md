# t140llm Maintainability & Readability Audit

**Date:** 2026-02-22
**Scope:** All 35 source files in `src/`, 16 test files in `tests/`
**Version:** 0.0.18

---

## Summary

| Category | Issues | Severity Range |
|----------|--------|----------------|
| Code Duplication | 6 | High–Critical |
| API Inconsistency | 4 | Medium–High |
| Deprecated Tooling | 3 | Medium–High |
| Type System Weakness | 6 | Medium–High |
| Error Handling Inconsistency | 4 | Medium |
| Module Organization | 3 | Medium–Critical |
| Test Quality & Coverage | 6 | High |
| **Total** | **32** | |

---

## M1. Code Duplication (CRITICAL)

### M1.1 Processor Files: ~715 Duplicated Lines Across 4 Files

The four main processor files total 1,047 lines with **45–60% duplication**:

| File | Lines | Estimated Unique |
|------|-------|-----------------|
| `process-ai-stream.ts` | 231 | ~120 |
| `process-ai-stream-to-rtp.ts` | 179 | ~90 |
| `process-ai-stream-to-srtp.ts` | 206 | ~100 |
| `process-ai-stream-to-direct-socket.ts` | 359 | ~140 |
| `process-ai-stream-to-multiplex.ts` | 72 | ~70 |

**Duplicated blocks:**

| Block | Lines | Files Affected |
|-------|-------|----------------|
| Stream data handler (text extraction + backspace + send) | ~238 | All 4 main processors |
| Transport creation & config merge | ~209 | RTP, SRTP, DirectSocket |
| Metadata handling + callback dispatch | ~63 | All 4, with 4 different patterns |
| Error handlers (all silently swallow) | ~56 | All 4 |
| Config merge logic | ~45 | All 4, inconsistent precedence |

### M1.2 Internal Duplication in DirectSocket Processor

`process-ai-stream-to-direct-socket.ts` contains **two near-identical implementations** of stream attachment:
- `createDirectSocketTransport()` internal `attachStream` (lines 87–170)
- `attachStreamToDirectSocketTransport()` standalone (lines 188–319)

These are ~90% identical, with the standalone version being 131 lines of copy-paste.

### M1.3 Recommendation

Extract a shared `StreamProcessor` utility:

```typescript
// src/utils/stream-processor.ts
export function attachStreamToTransport(
  stream: TextDataStream,
  transport: TransportStream,
  options: ProcessorOptions
): void { /* shared logic */ }
```

This would reduce the 4 processors to ~50 lines each: transport creation + calling the shared processor.

---

## M2. API Inconsistency (HIGH)

### M2.1 Parameter Order Reversal Between RTP and SRTP

```typescript
// RTP:  (stream, address, PORT, config, existing)
processAIStreamToRtp(stream, address, port, config, existingTransport)

// SRTP: (stream, address, CONFIG, port, existing) ← REVERSED
processAIStreamToSrtp(stream, address, srtpConfig, port, existingTransport)
```

Same reversal in factory functions:
```typescript
createT140RtpTransport(address, port, config)
createT140SrtpTransport(address, srtpConfig, port)  // ← config and port swapped
```

### M2.2 Naming Inconsistency

| Pattern | Files Using It |
|---------|---------------|
| `createWebSocketConnection()` | process-ai-stream.ts |
| `createT140RtpTransport()` | process-ai-stream-to-rtp.ts |
| `createT140SrtpTransport()` | process-ai-stream-to-srtp.ts |
| `createDirectSocketTransport()` | process-ai-stream-to-direct-socket.ts |

The WebSocket variant breaks the `createT140*Transport` naming convention.

### M2.3 Boolean Handling: 4 Different Patterns for Same Check

```typescript
// WebSocket + RTP (|| pattern)
if (options.processBackspaces || options.handleMetadata) { ... }

// SRTP (=== true)
if (options.processBackspaces === true) { ... }

// DirectSocket (?? pattern)
const processBackspaces = options.processBackspaces ?? false;
```

### M2.4 Metadata Callback: 4 Different Invocation Patterns

```typescript
// Pattern 1: Optional chaining
options.metadataCallback?.(metadata);

// Pattern 2: Truthiness check
if (options.metadataCallback) { options.metadataCallback(metadata); }

// Pattern 3: typeof check
if (typeof options.metadataCallback === 'function') { options.metadataCallback(metadata); }

// Pattern 4: Extracted variable
const cb = options.metadataCallback;
cb?.(metadata);
```

---

## M3. Deprecated Tooling (HIGH)

### M3.1 TSLint (Deprecated Since 2019)

`tslint.json` is the active linter. TSLint was officially deprecated by Palantir in 2019.
- **Migration path:** `tslint-to-eslint-config` tool, then `typescript-eslint`
- **Impact:** No new rule updates, community has moved on, editor plugins degrading
- CXNULL on specific deprecation announcement URL (known fact from Palantir's GitHub)

### M3.2 TypeScript 4.9.5 (3+ Minor Versions Behind)

Current: 5.x series. Missing features:
- `satisfies` operator (5.0)
- `const` type parameters (5.0)
- Stage 3 decorators (5.0)
- `isolatedDeclarations` (5.5)
- `--erasableSyntaxOnly` (5.8)

### M3.3 @types/node 13.x (5+ Years Behind)

`@types/node: ^13.13.52` targets Node 13 (EOL April 2020). Current LTS types are 20.x/22.x.
- Missing: `crypto.randomInt`, `crypto.randomUUID`, `fs.promises.*`, `AbortController`, `structuredClone`, `Intl.Segmenter` types (though code already uses it)
- This mismatch means TypeScript won't catch API usage errors for modern Node features

---

## M4. Type System Weakness (HIGH)

### M4.1 All-Optional Configuration

`RtpConfig` has **27 fields, all optional**, with no documented defaults and no runtime validation:

```typescript
export interface RtpConfig {
  payloadType?: number;    // What range? 96-127 per RFC?
  ssrc?: number;           // 32-bit unsigned?
  fecEnabled?: boolean;
  fecPayloadType?: number;
  fecGroupSize?: number;   // What range?
  // ... 22 more optional fields
}
```

No constructor or factory validates constraints. Invalid configs like `{ payloadType: -5, fecGroupSize: 0 }` pass type checking silently.

### M4.2 `any` Types in Public API

| Location | Type | Should Be |
|----------|------|-----------|
| `extractTextFromChunk(chunk: any)` | `any` | Union of known chunk shapes |
| `LLMMetadata.content` | `any` | Discriminated union by `type` |
| `StegConfig.llmProvider` | `any` | Provider interface |

### M4.3 `index.d.ts` Severely Out of Sync

The hand-maintained type declaration file is missing:
- `T140RtpMultiplexer`, `demultiplexStreams`, all multiplex types
- `processAIStreamToMultiplex`
- `ErrorFactory`, `T140RtpError`, `T140RtpErrorType`
- `generateSecureSSRC`, `createSrtpKeysFromPassphrase` (wrong signature — missing salt param)
- All `attach*` helper functions
- All steganography types
- `ProcessorOptions`, `LLMMetadata`

Wrong return types:
- `processAIStream` declared as returning `void`, actually returns `WebSocket.Server`

Stale declarations:
- Exports `wss` module-level variable (the side-effect bug in index.ts)

### M4.4 Local Interface Definitions Instead of Shared

`process-ai-stream.ts` defines `TLSOptions`, `WebSocketOptions`, `AttachStreamOptions` locally (~40 lines) instead of in `src/interfaces/`. These types are not importable by consumers.

### M4.5 SrtpConfig Inherits Unused Fields

`SrtpConfig extends RtpConfig` inherits `charRateLimit`, but the SRTP processor completely ignores it. Configuration is silently accepted and discarded.

### M4.6 SRTP Profile Accepts Any Number

`SrtpConfig.profile` is typed as `number` with no validation against the IANA SRTP profile registry (valid values: 0x0001–0x0008).

---

## M5. Error Handling Inconsistency (MEDIUM)

### M5.1 Three Different Error Patterns

| Pattern | Where Used |
|---------|-----------|
| `ErrorFactory.createError()` → EventEmitter | `t140-rtp-transport.ts` only |
| `console.error()` / `console.warn()` | `steg-transport.ts`, `websocket-server.ts` |
| Swallowed silently | All 4 processor error handlers |

`ErrorFactory` exists and is well-designed but is only used in a single file. The other 34 source files use ad-hoc patterns.

### M5.2 Processor Error Handlers Silently Swallow

All 4 processors bind error handlers that accept `_err` (underscore prefix = intentionally unused):

```typescript
stream.on('error', (_err) => {
  transport.close?.();
});
```

No logging, no re-emission, no callback notification. Errors vanish.

### M5.3 Console Logging in Library Code

Libraries should not write to stdout/stderr. Found in:
- `websocket-server.ts`: `console.log` for server start (line 54, 61, 66), `console.warn` for TLS failure
- `steg-transport.ts`: `console.error` at 4 locations for encoding/decoding failures

### M5.4 Metadata Callback Exceptions Not Caught

User-provided `metadataCallback` is called without try/catch. If the callback throws, it crashes the stream processing pipeline.

---

## M6. Module Organization (MEDIUM–CRITICAL)

### M6.1 Module-Level Side Effect on Import (CRITICAL)

`src/index.ts` line 39:
```typescript
const wss = createWebSocketServer();
```

**Importing `t140llm` starts a WebSocket server.** Any consumer doing `import { createRtpPacket } from 't140llm'` gets an unintended WebSocket server listening on a port. This is a critical design flaw.

### M6.2 Barrel Export Hygiene

`src/index.ts` uses `export *` from all submodules, which:
- Exports internal implementation details
- Makes it impossible to distinguish public API from internals
- Leaks `createDefaultTransport`, `ErrorFactory` internals, etc.

### M6.3 @types/ws as Runtime Dependency

`package.json` lists `@types/ws: 7.4.7` under `dependencies` instead of `devDependencies`. Type packages are build-time only and shouldn't be shipped to consumers.

---

## M7. Test Quality & Coverage Gaps (HIGH)

### M7.1 Untested Source Files

| Source File | Test Coverage | Risk |
|------------|---------------|------|
| `websocket-server.ts` | **None** | TLS fallback bug untested |
| `error-factory.ts` | **None** | Error creation/types untested |
| `security.ts` | **None** | Crypto operations untested |
| `transport-factory.ts` | **None** | Dynamic require, UDP creation untested |
| `rtp-config-extensions.ts` | **None** | Config extension untested |
| `constants.ts` | **None** | Low risk (just values) |

### M7.2 Weak Test Files

| Test File | Cases | Quality | Issue |
|-----------|-------|---------|-------|
| `steganography.test.ts` | ~8 | WEAK | No LSB round-trip, no security tests |
| `direct-socket-mode.test.ts` | 4 | STUBS | Only checks function was called |
| `integration.test.ts` | 3 | WEAK | All mocked, no real I/O |
| `multiplexer.test.ts` | ~12 | WEAK | Heavy mocking, manual event emission |

### M7.3 Mock Accuracy Issues

`src/__mocks__/index.ts` has divergences from real implementation:
- `T140RtpTransport` mock: `sendText` is bare `jest.fn()` — no packet format validation
- `createRtpPacket` mock: ignores multiplex/CSRC/FEC options entirely
- `processAIStreamToDirectSocket` mock: returns wrong type

### M7.4 Missing Test Categories

- **Security tests:** No tests for crypto operations, TLS, SRTP encryption
- **Negative tests:** No invalid input tests for most functions
- **Boundary tests:** No tests for sequence wrap, timestamp overflow, max payload
- **Concurrency tests:** No tests for race conditions
- **Resource cleanup tests:** No tests verifying socket/transport closure

---

## M8. Minor Readability Issues

### M8.1 Inconsistent Function Ordering

- `process-ai-stream-to-rtp.ts`: helpers first, then main export
- `process-ai-stream.ts`: main export first, then helpers
- No consistent pattern across files

### M8.2 Variable Naming

- `rtpState` vs `state` within same file (`t140-rtp-transport.ts`)
- `wss` (ambiguous — WebSocket Server or Secure WebSocket?)
- `rtp` used for both config objects and transport instances

### M8.3 Missing JSDoc on Public API

Most exported functions lack JSDoc. The few that exist are incomplete (missing `@param`, `@returns`, `@throws`).

---

*Generated by codebase audit, 2026-02-22*
