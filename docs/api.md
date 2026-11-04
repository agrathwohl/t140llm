# API reference

All functions accept a `stream` that is either an EventEmitter emitting text chunks or an async iterable (e.g. a direct LLM SDK stream).

For the config objects and exported types referenced below ([`RtpConfig`](/types#rtpconfig), [`SrtpConfig`](/types#srtpconfig), [`TransportStream`](/types#transportstream), [`LLMMetadata`](/types#metadata), [`T140RtpError`](/types#errors), …) see [Types & interfaces](/types). For hiding packets in cover media, see [Steganography](/steganography).

- [Processing functions](#processing-functions)
- [Receive-side helpers](#receive-side-helpers)
- [Transport factories](#transport-factories)
- [Pre-connecting transports](#pre-connecting-transports)
- [Stream attachment](#stream-attachment)
- [Utilities](#utilities)
- [Constants](#constants)
- [Classes](#classes)
- [TransportStream interface](#transportstream-interface)

## Processing functions

### processAIStream(stream, [websocketUrl], [options])

Sends the stream's text chunks as T.140 over a WebSocket.

- `stream`: the streaming data source.
- `websocketUrl` `string`: optional, defaults to `ws://localhost:8765`.
- `options` `object`: optional: `handleMetadata`, `metadataCallback`, `sendMetadataOverWebsocket`, `processBackspaces`.
- returns `void`.

### processAIStreamToRtp(stream, remoteAddress, [remotePort], [rtpConfig])

Sends text chunks directly as T.140 over RTP, paced at `charRateLimit` characters per second (default `30`, RFC 4103 §6). The first packet after an idle period carries the M-bit. When the stream ends, the queue drains at the same rate and the transport then closes. With `redEnabled`, every packet also carries the previous `redundancyLevel` blocks (RFC 2198). With `fecEnabled`, a Forward Error Correction packet per RFC 5109 follows every `fecGroupSize` packets. A custom transport, if provided, replaces the default UDP socket.

- `remoteAddress` `string`: remote IP (ignored when a custom transport is set).
- `remotePort` `number`: optional, defaults to `5004`.
- `rtpConfig` [`RtpConfig`](/types#rtpconfig): optional:
  - `payloadType` `number`: default `96`.
  - `ssrc` `number`: default: a cryptographically secure random value.
  - `initialSequenceNumber` `number`: default `0`.
  - `initialTimestamp` `number`: default `0`.
  - `timestampIncrement` `number`: optional. When set, timestamps advance by this fixed amount per packet. By default timestamps follow a 1000 Hz wall clock per RFC 4103 §3.
  - `fecEnabled` `boolean`: default `false`.
  - `fecPayloadType` `number`: default `97`.
  - `fecGroupSize` `number`: media packets protected per FEC packet, default `3`.
  - `redEnabled` `boolean`: T.140 redundancy (text/red, payload type `98`). Default `true`, per RFC 4103 §4. Set `false` for plain text/t140.
  - `redundancyLevel` `number`: redundant blocks per packet, default `2`.
  - `charRateLimit` `number`: characters per second, default `30`.
  - `onError` `(error: Error) => void`: called when the source stream fails.
  - `customTransport` [`TransportStream`](/types#transportstream): replaces the UDP socket.
- returns [`T140RtpTransport`](/api#t140rtptransport).

### processAIStreamToSrtp(stream, remoteAddress, [remotePort], srtpConfig)

Same as `processAIStreamToRtp`, but encrypts with SRTP. Throws when the key material is unusable; it never falls back to plaintext. `fecEnabled` is rejected together with SRTP because both would share one keystream.

- `remotePort` `number`: optional, defaults to `5006`.
- `srtpConfig` [`SrtpConfig`](/types#srtpconfig):
  - `masterKey` `Buffer`: required, 16 bytes.
  - `masterSalt` `Buffer`: required. 14 bytes for profile `0x0001`, 12 bytes for `0x0007`.
  - `remoteMasterKey`, `remoteMasterSalt` `Buffer`: optional receive-direction keys. Default to the send keys. DTLS-SRTP fills these in.
  - `profile` [`SrtpProtectionProfile`](/types#srtpprotectionprofile): optional, `0x0001` (default) or `0x0007`.
  - `customTransport` [`TransportStream`](/types#transportstream): optional.
- returns [`T140RtpTransport`](/api#t140rtptransport).

### processAIStreamToDtlsSrtp(stream, remoteAddress, [remotePort], [config])

Streams T.140 over SRTP with keys derived from a DTLS-SRTP handshake ([RFC 5764](https://www.rfc-editor.org/rfc/rfc5764)), the automatic key management RFC 3711 §9.1 requires. Nothing is shared out of band. Returns a promise, because the handshake runs first. The DTLS session and the SRTP media share one UDP 5-tuple.

- `remotePort` `number`: optional, defaults to `5006`.
- `config` [`RtpConfig`](/types#rtpconfig) without `customTransport`, plus:
  - `dtls` [`DtlsSrtpOptions`](/types#dtlssrtpoptions): role, certificate, profiles, timeout.
- returns `Promise<`[`T140RtpTransport`](/api#t140rtptransport)`>`.

```typescript
const transport = await processAIStreamToDtlsSrtp(stream, "192.168.1.100", 5006, {
  dtls: { role: "client" },
});
```

### createT140DtlsSrtpTransport(remoteAddress, [remotePort], [config])

Same handshake, but returns the transport, an `attachStream` function, and the [`DtlsSrtpSession`](/types#dtlssrtpsession) so you can inspect the negotiated profile and the peer certificate.

- returns `Promise<{ transport, attachStream, session }>`.

### negotiateDtlsSrtp(remoteAddress, remotePort, [options])

Runs only the handshake and returns the keys. Use it when you want to build the SRTP context yourself, or to get the receive-direction keys for decrypting inbound media.

- `options` [`DtlsSrtpOptions`](/types#dtlssrtpoptions).
- returns `Promise<`[`DtlsSrtpSession`](/types#dtlssrtpsession)`>`.

### processAIStreamToDirectSocket(stream, [socketPath], [rtpConfig])

Sends RTP-framed T.140 straight to a Unix SEQPACKET socket, skipping the WebSocket hop.

- `socketPath` `string`: optional, defaults to the library's default socket path.
- `rtpConfig` [`RtpConfig`](/types#rtpconfig): optional, same options as `processAIStreamToRtp`.
- returns [`T140RtpTransport`](/api#t140rtptransport).

### processAIStreamsToMultiplexedRtp(streams, remoteAddress, [remotePort], [rtpConfig])

Combines multiple streams into one multiplexed RTP output.

- `streams` `Map<string, TextDataStream>`: stream IDs to streams.
- `remotePort` `number`: optional, defaults to `5004`.
- `rtpConfig` [`RtpConfig`](/types#rtpconfig): optional, plus:
  - `multiplexEnabled` `boolean`: **required**, set `true`.
  - `useCsrcForStreamId` `boolean`: use the RTP CSRC field for stream IDs (recommended), default `false`.
  - `charRateLimit` `number`: combined character rate limit, default `30`.
- returns [`T140RtpMultiplexer`](/api#t140rtpmultiplexer).

## Receive-side helpers

### extractT140Text(packet, [redPayloadType])

Returns the text a T.140 receiver should display from one RTP packet. Handles text/red (payload type `98` by default) and plain text/t140, and skips the CSRC list, any header extension, and trailing padding. Redundant blocks are for recovering text from packets that never arrived, so they are not included.

- `packet` `Buffer`: a full RTP packet.
- `redPayloadType` `number`: optional, defaults to `98`.
- returns `string`.

### parseT140RedPacket(packet)

Parses a text/red packet per [RFC 2198 §3](https://www.rfc-editor.org/rfc/rfc2198#section-3) into its header fields, its redundant blocks (oldest first, each with a millisecond age), and its primary text. Throws when the packet is truncated.

- returns [`ParsedRedPacket`](/types#parsedredpacket).

## Transport factories

Each factory creates a transport up front and returns an `attachStream(stream, [options])` function, letting you connect before the LLM stream exists. See [Pre-connecting transports](#pre-connecting-transports).

### createT140WebSocketTransport(websocketUrl, [options])

- `websocketUrl` `string`: optional, defaults to `ws://localhost:8765`.
- `options.tlsOptions` `object`: optional TLS options for secure WebSocket.
- returns `{ connection, attachStream }`.

### createDirectSocketTransport(socketPath, [rtpConfig])

- returns `{ transport, attachStream, rtpState }` where `rtpState` is `{ sequenceNumber, timestamp, ssrc }`.

### createT140RtpTransport(remoteAddress, [remotePort], [rtpConfig])

- `remotePort`: optional, defaults to `5004`.
- returns `{ transport, attachStream }`.

### createT140SrtpTransport(remoteAddress, [remotePort], srtpConfig)

- `remotePort`: optional, defaults to `5006`.
- returns `{ transport, attachStream }`.

### createT140RtpMultiplexer(remoteAddress, [remotePort], [multiplexConfig])

- `multiplexConfig.multiplexEnabled` `boolean`: **required**, set `true`.
- `multiplexConfig.useCsrcForStreamId` `boolean`: optional, default `false`.
- returns [`T140RtpMultiplexer`](/api#t140rtpmultiplexer).

## Pre-connecting transports

Establishing the transport before the stream is available reduces startup latency and lets one transport serve multiple streams.

```typescript
import { createT140WebSocketTransport } from "t140llm";

const { connection, attachStream } = createT140WebSocketTransport("ws://localhost:5004");

function handleLLMResponse(llmStream) {
  attachStream(llmStream, { processBackspaces: true, handleMetadata: true });
}
```

The same pattern applies to `createDirectSocketTransport`, `createT140RtpTransport`, and
`createT140SrtpTransport`. See [`examples/pre_connect_example.js`](https://github.com/agrathwohl/t140llm/blob/master/examples/pre_connect_example.js).

## Stream attachment

Each function here binds a stream to a transport that you already created. The `process*` functions above are thin wrappers over them. Text extraction, the character rate limit, backspace handling, and metadata behave the same way in both.

### attachStreamToWebSocket(ws, stream, [options])

Sends the stream's text over an open `ws` WebSocket. `options` is [`AttachStreamOptions`](/types#websocket-options): [`ProcessorOptions`](/types#processor-options) plus `sendMetadataOverWebsocket` and `tlsOptions`. Returns `void`.

### attachStreamToRtpTransport(transport, stream, [rtpConfig], [processorOptions])

Sends the stream through a [`T140RtpTransport`](#t140rtptransport) that already exists. Returns `void`.

### attachStreamToSrtpTransport(transport, stream, srtpConfig, [processorOptions])

The same, for a transport whose SRTP keys are already set up. Returns `void`.

### attachStreamToDirectSocketTransport(transport, stream, [rtpConfig], [processorOptions], [rtpState])

Sends RTP-framed T.140 over a `net.Socket` or any [`TransportStream`](/types#transportstream). Pass `rtpState` to continue an existing sequence number and timestamp. Returns `void`.

### addAIStreamToMultiplexer(multiplexer, id, stream, [streamConfig], [processorOptions])

Adds one more stream to a running [`T140RtpMultiplexer`](#t140rtpmultiplexer). Returns `boolean`: `false` when `id` is already in use.

## Utilities

### createRtpPacket(sequenceNumber, timestamp, payload, [options])

Builds an RTP packet with a T.140 payload. `options` is `Partial<RtpConfig>`. Returns `Buffer`.

### createSrtpKeysFromPassphrase(passphrase)

Derives `{ masterKey, masterSalt }` from a passphrase. For production, use a stronger key derivation function and exchange keys securely.


### buildRtpHeader(fields)

Builds the 12-byte RTP fixed header, plus the CSRC list when you set one ([RFC 3550 section 5.1](https://www.rfc-editor.org/rfc/rfc3550#section-5.1)). `fields` is `RtpHeaderFields`: `marker`, `payloadType`, `sequenceNumber`, `timestamp`, `ssrc`, and optional `csrcList`. Throws on more than 15 CSRCs or a payload type outside 0 to 127. Returns `Buffer`.

### createT140Clock([initialTimestamp], [fixedIncrement])

Creates the 1000 Hz timestamp source that [RFC 4103 section 3](https://www.rfc-editor.org/rfc/rfc4103#section-3) needs. Returns `{ next(), now() }`. `next()` moves the timestamp to the current wall-clock millisecond and always advances at least one tick, so two packets never carry the same timestamp. Pass `fixedIncrement` to advance by a constant instead of by real time.

### generateSecureSSRC()

Returns a random 32-bit SSRC from `crypto.randomBytes`. Returns `number`.

### extractTextFromChunk(chunk, [extractMetadata])

Reads the text out of one chunk, for every SDK shape the library supports. Returns `ExtractedContent`: `{ text, metadata? }`. `text` is `''` when the chunk carries no string.

### processT140BackspaceChars(text, [textBuffer])

Applies T.140 backspaces to `textBuffer`. Returns `{ processedText, updatedBuffer, processedGraphemes }`. The buffer keeps the last 256 grapheme clusters, so one backspace erases an emoji or a combining sequence as a single character.

### toGraphemes(str)

Splits a string into grapheme clusters with `Intl.Segmenter`. Returns `string[]`.

### isAsyncIterable(stream)

Type guard. Returns `true` when the stream has `Symbol.asyncIterator`.

### resolveStreamOptions(processorOptions, [configOptions])

Merges per-call processor options over the transport's config. The per-call options win. Returns `ResolvedStreamOptions`.

### attachStreamProcessor(stream, options, callbacks)

The shared pipeline that every transport uses: text extraction, metadata, backspaces, and end of stream. `callbacks` is `{ sendText(text, graphemes?), close() }`. Returns a `detach()` function that removes the listeners.

### createWebSocketServer([options])

Starts a `ws` server for the WebSocket transport. `options` is [`WebSocketServerOptions`](/types#websocket-options). Returns `WebSocket.Server`.

### createWebSocketConnection(websocketUrl, [options])

Alias of [`createT140WebSocketTransport`](#createt140websockettransportwebsocketurl-options). Kept for older code.

## Constants

Every default the library uses is exported, so you can read a value instead of hard-coding it. Each one carries the RFC that fixes it.

### T.140 and RTP ([RFC 4103](https://www.rfc-editor.org/rfc/rfc4103), [RFC 3550](https://www.rfc-editor.org/rfc/rfc3550))

| Constant | Value | Meaning |
| --- | --- | --- |
| `T140_CLOCK_RATE` | `1000` | RTP clock rate in Hz, so one tick is one millisecond |
| `DEFAULT_CHAR_RATE_LIMIT` | `30` | Characters per second, the `cps` default in RFC 4103 section 6 |
| `SEND_INTERVAL_MS` | `100` | Buffering interval. RFC 4103 section 5.1 recommends 300 ms; this library trades packets for latency |
| `IDLE_THRESHOLD_MS` | `300` | Silence after which the next packet sets the marker bit |
| `BACKSPACE` | `"\b"` | The T.140 erase character |
| `RTP_VERSION` | `2` | RTP version in the header |
| `RTP_HEADER_SIZE` | `12` | Bytes in the fixed header |
| `RTP_MAX_SEQUENCE_NUMBER` | `65536` | Sequence numbers wrap at this value |
| `RTP_MAX_CSRC_COUNT` | `15` | The CC field is 4 bits |
| `RTP_CSRC_ENTRY_SIZE` | `4` | Bytes per CSRC entry |
| `RTP_FIRST_BYTE_MIN` | `128` | Lowest first byte of an RTP packet, used to tell RTP from DTLS |
| `RTP_FIRST_BYTE_MAX` | `191` | Highest first byte of an RTP packet |

### Payload types and ports

| Constant | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_T140_PAYLOAD_TYPE` | `96` | Dynamic payload type for `text/t140` |
| `DEFAULT_RED_PAYLOAD_TYPE` | `98` | Dynamic payload type for `text/red` |
| `DEFAULT_FEC_PAYLOAD_TYPE` | `97` | Dynamic payload type for FEC |
| `DEFAULT_METADATA_PAYLOAD_TYPE` | `99` | Dynamic payload type for metadata packets |
| `DEFAULT_RTP_PORT` | `5004` | Default RTP destination port |
| `DEFAULT_SRTP_PORT` | `5006` | Default SRTP destination port |
| `WS_SERVER_PORT` | `8765` | Default WebSocket server port |
| `SEQPACKET_SOCKET_PATH` | `"/tmp/seqpacket_socket"` | Default Unix socket path |

### Redundancy ([RFC 2198](https://www.rfc-editor.org/rfc/rfc2198))

| Constant | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_REDUNDANCY_LEVEL` | `2` | Older blocks repeated in each packet, which is the RFC 4103 section 4 default |
| `RED_MAX_BLOCK_LENGTH` | `1023` | The block length field is 10 bits |
| `RED_MAX_TIMESTAMP_OFFSET` | `16383` | The timestamp offset field is 14 bits, so a block older than 16383 ms cannot be carried |

### Forward error correction ([RFC 5109](https://www.rfc-editor.org/rfc/rfc5109))

| Constant | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_FEC_GROUP_SIZE` | `3` | Media packets per FEC packet |
| `FEC_MAX_GROUP_SIZE` | `16` | The protection mask is 16 bits |
| `FEC_HEADER_SIZE` | `10` | Bytes in the FEC header |
| `FEC_LEVEL_HEADER_SIZE` | `4` | Bytes in the FEC level header |

### SRTP and DTLS ([RFC 3711](https://www.rfc-editor.org/rfc/rfc3711), [RFC 5764](https://www.rfc-editor.org/rfc/rfc5764), [RFC 7714](https://www.rfc-editor.org/rfc/rfc7714))

| Constant | Value | Meaning |
| --- | --- | --- |
| `SRTP_MASTER_KEY_SIZE` | `16` | Master key bytes for AES-128 |
| `SRTP_MASTER_SALT_SIZE` | `14` | Master salt bytes for the AES-CM profiles |
| `SRTP_AEAD_SALT_SIZE` | `12` | Master salt bytes for the AES-GCM profiles, per RFC 7714 section 8.1 |
| `PBKDF2_ITERATIONS` | `600000` | Iterations in `createSrtpKeysFromPassphrase` |
| `PBKDF2_TOTAL_DERIVED_SIZE` | `30` | Bytes derived, which is key plus salt |
| `DTLS_HANDSHAKE_TIMEOUT_MS` | `10000` | Time the DTLS handshake may take before it fails |
| `DTLS_RECORD_FIRST_BYTE_MIN` | `20` | Lowest first byte of a DTLS record, used to demultiplex DTLS from SRTP on one port |
| `DTLS_RECORD_FIRST_BYTE_MAX` | `63` | Highest first byte of a DTLS record |

### Multiplexing, metadata, and rate limiting

| Constant | Value | Meaning |
| --- | --- | --- |
| `MULTIPLEX_STREAM_DELIMITER` | `"\u001e"` | ASCII record separator between the stream id and the text |
| `INITIAL_CSRC_ID` | `1` | First CSRC id the multiplexer hands out |
| `MIN_TOKENS_PER_STREAM` | `1` | Characters each stream may send per drain, at minimum |
| `MIN_TOKEN_BUCKET_VALUE` | `1` | Tokens needed before the bucket releases anything |
| `TOKEN_REFILL_RATE_DIVISOR` | `1000` | Converts characters per second into tokens per millisecond |
| `METADATA_PACKET_PREFIX` | `"MD:"` | Marks a metadata packet |
| `MAX_METADATA_PAYLOAD_SIZE` | `1200` | Largest metadata payload in bytes, which keeps the packet under a typical MTU |

## Classes

### T140RtpTransport

Manages an RTP/SRTP connection for sending T.140.

- `constructor(remoteAddress, [remotePort = 5004], [config])`: `config` accepts [`RtpConfig`](/types#rtpconfig), including `customTransport`.
- `setupSrtp(srtpConfig)`: initializes SRTP. Returns `void`.
- `sendText(text)`: sends text as T.140, generating FEC packets when enabled. Returns `void`.
- `close()`: closes the socket/transport, flushing any remaining FEC packets. Returns `void`.

### T140RtpMultiplexer

Multiplexes multiple LLM streams into one RTP output.

- `constructor(remoteAddress, [remotePort = 5004], [config])`.
- `addStream(id, stream, [streamConfig], [processorOptions])`: returns `boolean`.
- `removeStream(id)`: returns `boolean`.
- `getStreamCount()`: returns `number`.
- `getStreamIds()`: returns `string[]`.
- `close()`: closes the multiplexer and all streams.

**Events:** `streamAdded`, `streamRemoved`, `streamError`, `metadata`, `error`.

### T140StreamDemultiplexer

Extracts individual streams from multiplexed RTP packets on the receiving end.

- `constructor()`.
- `processPacket(data, [useCSRC = false])`: parses an RTP packet and routes it. Returns `void`.
- `getStream(streamId)`: returns `DemultiplexedStream | undefined`.
- `getStreamIds()`: returns `string[]`.

**Events:** `stream`, `data`, `error`.

```typescript
import { T140StreamDemultiplexer } from "t140llm";
import * as dgram from "dgram";

const socket = dgram.createSocket("udp4");
const demux = new T140StreamDemultiplexer();

socket.on("message", (msg) => demux.processPacket(msg, true));
demux.on("stream", (streamId, stream) => {
  stream.on("data", (text) => console.log(`[${streamId}] ${text}`));
});
socket.bind(5004);
```


### DemultiplexedStreamImpl

One stream that `T140StreamDemultiplexer` produced. The demultiplexer builds these for you; normally you only consume them through the `stream` event.

- `constructor(streamId)`.
- `streamId`: the id read from the CSRC or from the payload prefix.
- `pushText(text)`: emits `data`.
- `pushMetadata(metadata)`: emits `metadata`.
- `end()`: emits `end`.
- `error(error)`: emits `error`.

**Events:** `data`, `metadata`, `end`, `error`.

## TransportStream interface

Implement this to plug in your own transport (WebRTC data channel, custom socket, steganographic carrier, …). Anything satisfying it can be passed as `customTransport`.

- `send(data, [callback])`: sends a `Buffer`; `callback(error?)` fires on completion. Returns `void`.
- `close()`: optional; releases resources. Returns `void`.

```typescript
class MyTransport {
  send(data, callback) {
    // ...deliver data...
    if (callback) callback();
  }
  close() {}
}

processAIStreamToRtp(stream, "unused", 0, { customTransport: new MyTransport() });
```
