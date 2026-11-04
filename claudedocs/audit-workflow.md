# t140llm Remediation Workflow

**Date:** 2026-02-22
**Input Documents:**
- `audit-security-practices.md` — 19 security/bad-practice issues
- `audit-bugs.md` — 20 bugs/errors
- `audit-maintainability.md` — 32 maintainability issues

**Total Issues:** 71

---

## Prioritization Principles

1. **Security vulnerabilities** that allow remote code execution or data exposure come first
2. **Data-corrupting bugs** that silently break functionality come second
3. **Protocol correctness** issues that affect interoperability come third
4. **Architecture debt** that blocks further development comes fourth
5. **Cosmetic/maintenance** improvements come last

Issues within a phase are ordered by effort (lowest first) to maximize velocity.

---

## Phase 0: Emergency Security Hardening

**Goal:** Eliminate all Critical/High security vulnerabilities.
**Estimated effort:** 1–2 days
**Breaking changes:** None expected

| # | Issue | Refs | Effort | Files Changed |
|---|-------|------|--------|---------------|
| 1 | Remove `eval()` — replace LLM encode mode with predefined algorithm registry | S1, B3, B17, S19 | 2h | `steg-transport.ts` |
| 2 | Replace `Math.random()` with `crypto.randomBytes()` in steganography | S2 | 30m | `steg-transport.ts` |
| 3 | Throw on TLS failure instead of silent WS fallback | S3 | 30m | `websocket-server.ts` |
| 4 | Add error handler to UDP socket in `createDefaultTransport` | S4 | 15m | `transport-factory.ts` |
| 5 | Add connect/error handlers to SEQPACKET socket | S5 | 30m | `websocket-server.ts` |
| 6 | Add PEM format validation on certificate loading | S6 | 30m | `websocket-server.ts` |

**Rationale:** Items 1–3 are Critical. eval() is RCE, Math.random() defeats steg security, TLS fallback exposes plaintext. Items 4–6 are crash-prevention. All are isolated changes with no cross-file dependencies.

**Verification:**
- Steganography works with `encodeMode: 'fixed'` (eval removed)
- No `Math.random()` calls remain in security-sensitive paths
- WebSocket server throws when TLS certs are invalid
- UDP socket survives network errors without crashing
- Existing tests pass

---

## Phase 1: Critical Bug Fixes

**Goal:** Fix bugs that cause data corruption or silent failure.
**Estimated effort:** 1 day
**Breaking changes:** B1 removes `wss` export

| # | Issue | Refs | Effort | Files Changed |
|---|-------|------|--------|---------------|
| 7 | Remove module-level `createWebSocketServer()` call | B1, M6.1 | 15m | `index.ts` |
| 8 | Fix LSB length encoding (`i % 8` → `i`) | B2 | 15m | `steg-transport.ts` |
| 9 | Fix config merging (`\|\|` → `??`) | B6 | 30m | `t140-rtp-transport.ts` |
| 10 | Fix silent steg fallback — throw instead of sending raw data | B19 | 15m | `steg-transport.ts` |

**Rationale:** B1 is the most impactful user-facing bug (import side effect). B2 limits steganography to 255 bytes — a fundamental correctness issue. B6 silently overrides valid config values.

**Verification:**
- `import { createRtpPacket } from 't140llm'` does NOT start a server
- LSB encode/decode round-trips data > 255 bytes
- `payloadType: 0` survives config merging
- Steg encoding failure throws instead of sending raw

---

## Phase 2: Protocol Correctness

**Goal:** Fix RTP/SRTP/FEC compliance issues per RFCs 3550, 5109.
**Estimated effort:** 1–2 days
**Breaking changes:** None

| # | Issue | Refs | Effort | Files Changed |
|---|-------|------|--------|---------------|
| 11 | Fix FEC header to XOR all packets' ts/length | B5 | 30m | `t140-rtp-transport.ts` |
| 12 | Fix FEC mask precision (Math.pow → bitwise shift) | B4 | 15m | `t140-rtp-transport.ts` |
| 13 | Fix RTP timestamp wrapping (both files) | B9, B18 | 15m | `t140-rtp-transport.ts`, `websocket-server.ts` |
| 14 | Deduplicate RTP packet creation when FEC enabled | B15 | 30m | `t140-rtp-transport.ts` |
| 15 | Fix CSRC payload extraction in demultiplexer | B12 | 1h | `demultiplex-streams.ts` |
| 16 | Fix address validation regex (add IPv6, localhost) | B16 | 30m | `t140-rtp-transport.ts` |

**Rationale:** These are all in the RTP/protocol layer and can be batched. FEC fixes (11–12) are highest priority since incorrect FEC is worse than no FEC. Timestamp wrapping is a ticking time bomb for long sessions.

**Verification:**
- FEC packets contain XOR'd values from all group members
- FEC mask correct for groups ≤ 31
- Timestamps wrap at 2^32
- CSRC demultiplexing delivers payload text
- `localhost` and IPv6 accepted

---

## Phase 3: Error Handling & Resilience

**Goal:** Eliminate silent failures, establish consistent error pattern.
**Estimated effort:** 1–2 days
**Breaking changes:** Possible (error callback addition to ProcessorOptions)

| # | Issue | Refs | Effort | Files Changed |
|---|-------|------|--------|---------------|
| 17 | Propagate stream errors via callback in all processors | S9 | 1h | All 4 processors |
| 18 | Wrap metadataCallback in try/catch | S13 | 30m | All 4 processors |
| 19 | Flush backspace buffer on stream end | S11 | 30m | All 4 processors |
| 20 | Replace console.log/warn/error with `debug` package | S15, M5.3 | 1h | `websocket-server.ts`, `steg-transport.ts` |
| 21 | Restructure dynamic `require()` to static import | S7 | 1h | `transport-factory.ts` |
| 22 | Handle ignored return value from processAIStreamToRtp | S10 | 30m | `transport-factory.ts` |

**Rationale:** These build on Phase 0/1 fixes. Error propagation (17) is the single most impactful change for debuggability. Console removal (20) makes the library production-ready. Phases 0–3 together produce a "safe and correct" library.

**Verification:**
- Stream errors reach caller via onError callback
- Bad metadataCallback doesn't crash pipeline
- Final buffer content delivered before close
- No console.* in library output
- `require()` replaced with static import

---

## Phase 4: Type Safety & Declarations

**Goal:** Fix type system issues that mask bugs or mislead consumers.
**Estimated effort:** 1–2 days
**Breaking changes:** index.d.ts will change significantly

| # | Issue | Refs | Effort | Files Changed |
|---|-------|------|--------|---------------|
| 23 | Regenerate `index.d.ts` from source (or delete it) | B7, M4.3 | 1h | `index.d.ts`, `tsconfig.prod.json` |
| 24 | Fix werift-rtp import (RtpPacket default import) | B8 | 30m | `t140-rtp-transport.ts`, `werift-rtp.d.ts` |
| 25 | Fix SrtpSession constructor and .encrypt calls | B8 | 1h | `t140-rtp-transport.ts` |
| 26 | Add SRTP profile validation (enum/union type) | S14, M4.6 | 30m | `srtp-config.interface.ts`, `process-ai-stream-to-srtp.ts` |
| 27 | Replace `any` types in public API | M4.2 | 1h | `extract-text.ts`, `text-data-stream.interface.ts`, `steg-config.interface.ts` |
| 28 | Move local interfaces to `src/interfaces/` | M4.4 | 30m | `process-ai-stream.ts`, `interfaces/` |

**Rationale:** Type declaration fixes (23–25) ensure TypeScript consumers get correct information. The werift-rtp mismatch (24–25) may indicate SRTP is broken at runtime — this must be investigated.

**Verification:**
- `tsc --noEmit` produces no errors on source files
- index.d.ts matches actual exports
- No `any` in public-facing signatures
- SRTP encryption actually works with correct werift-rtp API

---

## Phase 5: Architecture Improvements

**Goal:** Reduce code duplication, standardize API surface.
**Estimated effort:** 2–3 days
**Breaking changes:** Parameter order standardization is breaking

| # | Issue | Refs | Effort | Files Changed |
|---|-------|------|--------|---------------|
| 29 | Extract shared `StreamProcessor` utility from processors | M1.1, M1.2, M1.3 | 4h | All 5 processors, new `stream-processor.ts` |
| 30 | Standardize parameter ordering (config always last) | M2.1 | 1h | `process-ai-stream-to-srtp.ts`, `index.ts`, `index.d.ts` |
| 31 | Standardize naming (`createT140*Transport` everywhere) | M2.2 | 30m | `process-ai-stream.ts` |
| 32 | Standardize boolean/callback patterns | M2.3, M2.4 | 1h | All 4 processors |
| 33 | Implement rate limiting in SRTP processor (or remove from config) | S8, M4.5 | 2h | `process-ai-stream-to-srtp.ts` or `srtp-config.interface.ts` |
| 34 | Add metadata size validation for DirectSocket | S12 | 30m | `process-ai-stream-to-direct-socket.ts` |
| 35 | Fix colon delimiter ambiguity in demultiplexer | B13 | 1h | `demultiplex-streams.ts` |
| 36 | Remove/replace bufferLock | B14 | 15m | `process-ai-stream.ts` |

**Rationale:** The processor extraction (29) is the highest-impact refactor — it eliminates ~715 lines of duplication and makes all future processor changes single-point. Parameter standardization (30) is breaking but necessary for a sane API.

**Verification:**
- All processor tests pass with shared utility
- Parameter ordering consistent across all public functions
- Rate limiting works identically in RTP and SRTP (or SRTP config doesn't accept it)
- Metadata capped at safe UDP size

---

## Phase 6: Tooling Modernization

**Goal:** Update deprecated dependencies and build tools.
**Estimated effort:** 1–2 days
**Breaking changes:** Minimum Node version may increase

| # | Issue | Refs | Effort | Files Changed |
|---|-------|------|--------|---------------|
| 37 | Migrate tslint → eslint + typescript-eslint | M3.1 | 2h | `tslint.json` → `.eslintrc`, `package.json` |
| 38 | Upgrade TypeScript 4.9.5 → 5.x | M3.2 | 1h | `package.json`, `tsconfig.json` |
| 39 | Upgrade @types/node 13.x → 20.x+ | M3.3 | 30m | `package.json` |
| 40 | Move @types/ws to devDependencies | S18, M6.3 | 5m | `package.json` |
| 41 | Clean up barrel exports (explicit re-exports) | M6.2 | 1h | `index.ts` |

**Rationale:** Tooling upgrades unlock better static analysis, catch more bugs, and attract contributors who won't touch tslint. They're deferred to Phase 6 because they're noisy (lots of lint fixups) and don't fix user-facing issues.

**Verification:**
- `npm run lint` passes with eslint
- `npm run build` passes with TypeScript 5.x
- All tests pass with updated @types/node
- No internal symbols leak from index.ts

---

## Phase 7: Test Coverage

**Goal:** Cover untested code paths and fix test quality.
**Estimated effort:** 2–3 days
**Breaking changes:** None

| # | Issue | Refs | Effort | Files Changed |
|---|-------|------|--------|---------------|
| 42 | Add tests for `websocket-server.ts` (TLS, socket, errors) | M7.1 | 2h | new test file |
| 43 | Add tests for `security.ts` (SSRC, PBKDF2) | M7.1 | 1h | new test file |
| 44 | Add tests for `error-factory.ts` | M7.1 | 30m | new test file |
| 45 | Add LSB round-trip tests for steganography | M7.2 | 1h | `steganography.test.ts` |
| 46 | Fix test type errors (private access, union types) | B20 | 1h | 6 test files |
| 47 | Add negative/boundary tests (invalid config, overflow, max payload) | M7.4 | 2h | various test files |
| 48 | Update mocks to match real implementation signatures | M7.3 | 1h | `__mocks__/index.ts` |

**Rationale:** Tests are deferred to Phase 7 because Phases 0–5 change significant amounts of code — writing tests against the pre-fix API would mean rewriting them immediately. Write tests against the corrected implementation.

**Verification:**
- Coverage ≥ 80% on all source files
- No type errors in test files under strict mode
- All mocks match real function signatures

---

## Phase 8: Documentation & Polish

**Goal:** API documentation, JSDoc, remaining cleanup.
**Estimated effort:** 1–2 days
**Breaking changes:** None

| # | Issue | Refs | Effort | Files Changed |
|---|-------|------|--------|---------------|
| 49 | Add JSDoc to all public exports | M8.3 | 2h | All source files |
| 50 | Add RtpConfig defaults documentation | M4.1 | 30m | `rtp-config.interface.ts` |
| 51 | Add backpressure mechanism to TransportStream | S16 | 1h | `transport-stream.interface.ts`, processors |
| 52 | Make `close()` required on TransportStream | S17 | 30m | `transport-stream.interface.ts`, consumers |
| 53 | Standardize function ordering (exports last) | M8.1 | 1h | All processors |
| 54 | Standardize variable naming | M8.2 | 30m | Various |
| 55 | Adopt consistent ErrorFactory usage across codebase | M5.1 | 1h | Various |
| 56 | Document metadata extraction priority order | B10, B11 | 30m | `extract-text.ts` |

---

## Phase Summary

| Phase | Issues | Days | Cumulative | Result |
|-------|--------|------|------------|--------|
| 0: Emergency Security | 6 | 1–2 | 1–2 | No RCE, no plaintext leaks |
| 1: Critical Bugs | 4 | 1 | 2–3 | No data corruption |
| 2: Protocol Correctness | 6 | 1–2 | 3–5 | RFC-compliant RTP/FEC |
| 3: Error Handling | 6 | 1–2 | 4–7 | Safe, debuggable library |
| 4: Type Safety | 6 | 1–2 | 5–9 | Correct TypeScript types |
| 5: Architecture | 8 | 2–3 | 7–12 | Clean, DRY codebase |
| 6: Tooling | 5 | 1–2 | 8–14 | Modern build pipeline |
| 7: Test Coverage | 7 | 2–3 | 10–17 | Comprehensive tests |
| 8: Documentation | 8 | 1–2 | 11–19 | Production-ready library |
| **Total** | **56** | **11–19** | | |

---

## Critical Path

```
Phase 0 (security) → Phase 1 (critical bugs) → Phase 2 (protocol)
         ↓
Phase 3 (errors) → Phase 4 (types) → Phase 5 (architecture)
                                              ↓
                              Phase 6 (tooling) → Phase 7 (tests) → Phase 8 (docs)
```

**Phases 0–2 are sequential** (each builds on prior fixes).
**Phases 3–4 can overlap** (error handling and type fixes are independent).
**Phase 5 depends on 3+4** (architecture refactor needs consistent error/type patterns).
**Phases 6–8 are sequential** (tooling before tests, tests before docs).

---

## Quick Wins (< 30 min each, safe standalone)

These can be done at any time without risk:

1. Move `@types/ws` to devDependencies (S18) — 5 min
2. Remove module-level `createWebSocketServer()` (B1) — 15 min
3. Fix `||` → `??` in config merging (B6) — 15 min
4. Fix LSB `i % 8` bug (B2) — 15 min
5. Fix timestamp wrapping (B9, B18) — 15 min
6. Replace `Math.random()` with `crypto.randomBytes()` (S2) — 15 min
7. Fix address validation regex (B16) — 15 min
8. Remove/replace bufferLock (B14) — 15 min

---

*Generated by codebase audit, 2026-02-22*
