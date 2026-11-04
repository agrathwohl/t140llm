<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# tests

## Purpose
Jest test suites for the library. Jest matches `tests/**/*.test.ts` and transforms TypeScript with babel-jest (see `../jest.config.js`). Every suite imports real modules by path. Network I/O is replaced by `jest.mock('dgram' | 'net' | 'ws')` or by a capturing `customTransport` object.

## Key Files
| File | Covers |
|------|--------|
| `rfc4103-wire-format.test.ts` | Bit-level checks against the RFCs: RED block headers (RFC 2198 §3, oldest block first, idle drain per RFC 4103 §5.2), FEC header and level header (RFC 5109 §7, own sequence space), 1000 Hz timestamps, SRTP fail-closed, close idempotence, config range checks, no re-send of the backspace buffer, detach, SDK event objects yield no text, multiplexer backspaces and drain-then-remove, demultiplexer X and P bits |
| `async-iterator.test.ts` | `attachStreamProcessor` and `resolveStreamOptions` with `AsyncIterable` and `EventEmitter` inputs |
| `backspace-processing.test.ts` | `toGraphemes` and `processT140BackspaceChars`: emoji, ZWJ, skin tones, combining marks, flags, keycaps |
| `custom-transport.test.ts` | `T140RtpTransport` and `processAIStreamToRtp` with a capturing `TransportStream`: framing, marker bit, close on end and on error |
| `direct-socket-mode.test.ts` | `processAIStreamToDirectSocket` with `net` mocked: socket path, RTP framing, sequence numbers, `end()` on end and error, socket errors to `onError`, `customTransport` bypass |
| `existing-transport.test.ts` | Passing an existing transport or connection to each `processAIStream*` function |
| `integration.test.ts` | All five chunk formats through capturing transports; the same text through WebSocket, RTP, SRTP, and direct socket; close on end |
| `multiplexer.test.ts` | `T140RtpMultiplexer` constructor, `addStream`, `removeStream`, data flow, `close`; mocks `t140-rtp-transport` with `jest.mock` |
| `multiplexing-e2e.test.ts` | Multiplexer to `T140StreamDemultiplexer` round trip; mocks `t140-rtp-transport` |
| `processing-functions.test.ts` | Each processor function with `ws` mocked: WebSocket buffering until open, RTP, SRTP ciphertext and key errors, direct socket, passphrase keys |
| `reasoning-stream.test.ts` | `extractTextFromChunk` on reasoning chunks and metadata handling |
| `rtp-packet.test.ts` | `createRtpPacket` header layout, random SSRC, marker bit, metadata packets (payload type 99, `MD:` prefix) |
| `rtp-packet-with-multiplex.test.ts` | `createRtpPacket` with CSRC lists, stream identifiers, and metadata packets |
| `srtp.test.ts` | `SrtpConfig` validation, key and salt size errors, `createSrtpKeysFromPassphrase` with a returned salt |
| `steganography.test.ts` | `StegTransport`, `createStegT140RtpTransport`, `processAIStreamToStegRtp`; mocks `dgram` |
| `t140-rtp-transport.test.ts` | `T140RtpTransport` with `dgram` mocked and with a capturing transport: defaults, header fields, `timestampIncrement`, RED payload type, `close`, `setupSrtp` success and failures |
| `t140-rtp-transport-multiplex.test.ts` | `T140RtpTransport.sendText` with multiplex options and error handling; mocks `dgram` |
| `text-extraction.test.ts` | `extractTextFromChunk` on provider chunk shapes, Buffer input, tool-call metadata, `extractMetadata=false` |

## For AI Agents

### Working In This Directory
- Import real modules by path, for example `'../src/rtp/t140-rtp-transport'`. There is no mock of the package root any more.
- Never open real sockets. Pass `customTransport: { send(buf, cb) { ...; cb?.(); }, close() {} }` in the RtpConfig, or `jest.mock('dgram')` as `t140-rtp-transport-multiplex.test.ts` does.
- The RTP and SRTP processors pace output at 30 characters per second and close the transport only after the queue drains. Send at most 30 characters per test, or use jest fake timers and advance them.
- `createRtpPacket` picks a random SSRC when none is given. Pass `ssrc` when you assert it.
- `srtp.test.ts` takes about 4 seconds because PBKDF2 runs 600000 iterations.

### Testing Requirements
- `npm test` runs all suites. `npx jest tests/<name>.test.ts` runs one.
- `npm run test:coverage` writes to `../coverage/`.
- Tests do not type-check (babel-jest). Run `npx tsc --noEmit -p tsconfig.json` for that.

### Common Patterns
- A mock LLM stream is an `EventEmitter` that emits `'data'` chunks, then `'end'`, or an async generator.
- Provider chunk shapes under test: OpenAI `choices[0].delta`, Anthropic `delta.text` / `delta.tool_use`, Gemini `candidates`, Ollama `response`, reasoning deltas.

## Dependencies

### Internal
- `../src/**`

### External
- `jest`, `babel-jest`, `ws`, Node `events`, `dgram`, `net`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
