<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# processors

## Purpose
The public entry points. One file per transport. Each file exposes three levels: attach a stream to an existing transport, create a transport, and process (create plus attach).

## Key Files
| File | Transport | Exports |
|------|-----------|---------|
| `index.ts` |: | Barrel for the six files below. |
| `process-ai-stream.ts` | WebSocket (`ws://localhost:8765` by default) | `attachStreamToWebSocket(ws, stream, options)`, `createT140WebSocketTransport(url, options)`, alias `createWebSocketConnection`, `processAIStream(stream, url, options, existingConnection?)`. Text that arrives before `'open'` is buffered; socket errors go to `options.onError`; `tlsOptions` with a non-`wss://` URL throws. |
| `process-ai-stream-to-rtp.ts` | RTP over UDP (port 5004) | `attachStreamToRtpTransport(transport, stream, rtpConfig, options)`, `createT140RtpTransport(address, port, rtpConfig)`, `processAIStreamToRtp(stream, address, port, rtpConfig, existingTransport?)`. Token bucket at `charRateLimit` (default 30 chars/s), first send after idle sets the marker bit, remaining text drains every `SEND_INTERVAL_MS`. When the source ends the queue finishes draining and then the transport closes. |
| `process-ai-stream-to-srtp.ts` | SRTP (port 5006) | `attachStreamToSrtpTransport(...)` delegates to `attachStreamToRtpTransport`, so SRTP gets the same pacing. `createT140SrtpTransport(...)`, `processAIStreamToSrtp(stream, address, port, srtpConfig, existingTransport?)`. A private `validateSrtpConfig` throws when `masterKey` or `masterSalt` is missing, empty, or not a `Buffer`; `setupSrtp` then checks the lengths. For keys negotiated over the wire, use `process-ai-stream-to-dtls-srtp.ts` instead. |
| `process-ai-stream-to-dtls-srtp.ts` | SRTP with negotiated keys (port 5006) | `createT140DtlsSrtpTransport(address, port, config)` and `processAIStreamToDtlsSrtp(stream, address, port, config)`, both async. They call `negotiateDtlsSrtp` from `../rtp/dtls-srtp`, then `setupSrtp` with all four derived keys, and send over the handshake's socket. `config.dtls` holds the `DtlsSrtpOptions`. `customTransport` is not accepted, because the DTLS session owns the socket. |
| `process-ai-stream-to-direct-socket.ts` | Unix socket (`/tmp/seqpacket_socket`) or any `TransportStream` | `attachStreamToDirectSocketTransport(transport, stream, rtpConfig, options, rtpState?)`, `createDirectSocketTransport(path, rtpConfig)`, `processAIStreamToDirectSocket(...)`, `interface DirectSocketRtpState`. One RTP packet per text chunk, no pacing, timestamps from `createT140Clock`. A `net.Socket` gets an `'error'` listener that reports through `onError`. Metadata packets are capped at `MAX_METADATA_PAYLOAD_SIZE`. |
| `process-ai-stream-to-multiplex.ts` | One RTP stream for many LLMs | `createT140RtpMultiplexer(address, port, config)`, `processAIStreamsToMultiplexedRtp(streams: Map, address, port, config, options)`, `addAIStreamToMultiplexer(multiplexer, id, stream, config, options)`. Thin wrappers over `T140RtpMultiplexer`. |

## For AI Agents

### Working In This Directory
- Keep the three-level shape when you add a transport: `attachStreamTo<X>`, `create<X>Transport`, `processAIStreamTo<X>`.
- Call `resolveStreamOptions` and then `attachStreamProcessor` from `../utils/stream-processor.ts`. Do not re-implement text extraction or backspace handling in a processor.
- `processAIStream*` functions pass their config straight to the attach function. `resolveStreamOptions` reads `processBackspaces`, `handleMetadata`, `metadataCallback`, and `onError` from the config, so there is no need to copy those fields into a separate options object.
- The pre-connect factories (`createT140WebSocketTransport`, `createDirectSocketTransport`) open a socket before any stream is attached, so they attach their own `'error'` listener. Without it a refused connection exits the process.
- Every `processAIStream*` function accepts an existing transport or connection. `tests/existing-transport.test.ts` checks this for all four transports.
- Export new public functions from `index.ts`; the package root re-exports this directory with `export *`.
- Add new public functions to `../../docs/api.md`.

### Testing Requirements
- `tests/processing-functions.test.ts`, `tests/existing-transport.test.ts`, `tests/custom-transport.test.ts`, `tests/direct-socket-mode.test.ts`, `tests/srtp.test.ts`, `tests/async-iterator.test.ts`, and `tests/reasoning-stream.test.ts` cover this directory. The RTP and SRTP processors pace output, so tests either send at most 30 characters or use jest fake timers.

### Common Patterns
- Defaults come from `../utils/constants.ts`; processors never hard-code ports or payload types.
- The RTP processor and the multiplexer both implement the same token-bucket rate limit and idle detection.

## Dependencies

### Internal
- `../interfaces`, `../rtp/t140-rtp-transport`, `../rtp/t140-rtp-multiplexer`, `../rtp/create-rtp-packet`, `../rtp/t140-clock`, `../utils/stream-processor`, `../utils/constants`, `../utils/security`, `../utils/backspace-processing`

### External
- `ws`, Node `net`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
