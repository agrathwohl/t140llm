<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# rtp

## Purpose
RTP and SRTP send path: the header and packet builders, the text/t140 timestamp clock, the single-stream transport with redundancy and FEC, and the multiplexer that merges several LLM streams into one RTP output.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Barrel for the five files below. |
| `create-rtp-packet.ts` | `buildRtpHeader(fields)` writes the RFC 3550 fixed header plus CSRC list and throws on more than 15 CSRCs or a payload type above 127. `createRtpPacket(sequenceNumber, timestamp, payload, options)` adds the UTF-8 T140block; `metadataPacket` prefixes `MD:` and uses payload type 99 by default; prefix-mode multiplexing prepends `<streamIdentifier>\x1E`. The marker bit is set only when `options.markerBit` is true. |
| `t140-clock.ts` | `createT140Clock(initialTimestamp, fixedIncrement?)` returns `{ next(), now() }`. Default: milliseconds of wall time, advancing by at least 1 per packet (RFC 4103 §3, 1000 Hz, no repeated timestamps). With `fixedIncrement` it adds that amount per packet (legacy `timestampIncrement`). |
| `t140-rtp-transport.ts` | `class T140RtpTransport extends EventEmitter`. Constructor `(remoteAddress, remotePort = 5004, config)` validates host, port, payload types, SSRC, sequence number, timestamp, `fecGroupSize` (1–16), and opens a `udp4` or `udp6` socket unless `config.customTransport` is given. `setupSrtp(SrtpConfig)` throws on a bad key (16 bytes) or salt (14 bytes for profile 0x0001, 12 for 0x0007), accepts separate `remoteMasterKey`/`remoteMasterSalt`, refuses `fecEnabled`, and is a no-op when a session already exists. `sendText(text, options?)` builds one packet per call; `redEnabled` defaults to true (RFC 4103 §4), so it emits a text/red packet (RFC 2198 layout, oldest block first, offsets above 16383 dropped, one history per `streamIdentifier`) and arms a drain timer that sends empty primaries after idle (RFC 4103 §5.2); with `fecEnabled` it emits one RFC 5109 FEC packet per group from its own sequence counter. `close()` flushes a pending FEC group, closes the socket, and is idempotent; `sendText` after `close` is ignored. Emits only `'error'` with a `T140RtpError`. |
| `dtls-srtp.ts` | `negotiateDtlsSrtp(remoteAddress, remotePort, options)` runs a DTLS-SRTP handshake (RFC 5764) and returns `{ masterKey, masterSalt, remoteMasterKey, remoteMasterSalt, profile, remoteCertificate, transport, localAddress, close }`. The DTLS records and the SRTP media share one UDP socket, separated by the first byte per RFC 5764 §5.1.2 (20-63 DTLS, 128-191 RTP). It generates a self-signed ECDSA certificate unless `certPem`/`keyPem` are given. `role: 'server'` waits and learns the peer address from the first datagram; `certificateRequest: true` makes a server ask for the client certificate. Imports werift-dtls through the deep path `werift-dtls/lib/dtls/src`, because that package declares a `main` file it does not ship. |
| `t140-rtp-multiplexer.ts` | `class T140RtpMultiplexer extends EventEmitter`. Owns one `T140RtpTransport`. `addStream(id, stream, streamConfig?, processorOptions?)` runs the stream through `attachStreamProcessor` (so backspaces and metadata work), assigns a CSRC id when `useCsrcForStreamId`, and strips any per-stream `ssrc`. A shared token bucket limits characters per second across streams; the first send after `IDLE_THRESHOLD_MS` sets the marker bit. When a source stream ends, its queue drains at the rate limit and then the stream is removed. `removeStream(id)` removes now and flushes its queue. `close()`, `getStreamCount()`, `getStreamIds()`, `getTransport()`. Emits `'error'`, `'streamError'`, `'streamAdded'`, `'streamRemoved'`, `'metadata'` (tagged with `streamId`). |

## For AI Agents

### Working In This Directory
- The project lint rule requires private method names to start with `_` and lines to stay under 100 characters.
- `tests/rfc4103-wire-format.test.ts` decodes RED and FEC packets bit by bit against RFC 2198, RFC 4103, and RFC 5109. Run it after any change to the packet builders.
- Report failures with `this.emit('error', ErrorFactory.X(...))`. Do not throw from the send path. Constructor and `setupSrtp` do throw, because a bad configuration must not send anything.
- FEC shares the media SSRC and goes to the same port. RFC 5109 §14.1 says to avoid that; a separate FEC session would need its own port and, under SRTP, its own key. That is why `setupSrtp` rejects `fecEnabled`.
- Sequence numbers wrap at 65536. Timestamps wrap at 2^32 through `>>> 0`.
- The constructor rejects a `customTransport` without a `send` function, and `_encryptAndSend` catches a synchronous throw from one, because it runs from a drain timer.
- Redundancy is the default. Tests that assert plain framing must pass `redEnabled: false`.

### Testing Requirements
- `tests/t140-rtp-transport-multiplex.test.ts` mocks `dgram`. `tests/multiplexer.test.ts` and `tests/multiplexing-e2e.test.ts` mock this transport with `jest.mock`. `tests/rfc4103-wire-format.test.ts` and `tests/rtp-packet-with-multiplex.test.ts` use a capturing `customTransport` and check header bytes.

### Common Patterns
- Every packet header goes through `buildRtpHeader`. Do not hand-write header bytes.
- Rate limiting is a token bucket: tokens refill at `charRateLimit / TOKEN_REFILL_RATE_DIVISOR` per millisecond.
- Redundancy history is kept per `streamIdentifier` so blocks from different streams never share a packet.

## Dependencies

### Internal
- `../interfaces`, `../utils/constants`, `../utils/error-factory`, `../utils/security`, `../utils/backspace-processing`, `../utils/stream-processor`

### External
- `werift-rtp` (`RtpPacket`, `SrtpSession`), Node `dgram`, `net` (`isIP`), `events`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
