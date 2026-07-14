# API reference

All functions accept a `stream` that is either an EventEmitter emitting text chunks or an async iterable (e.g. a direct LLM SDK stream).

- [Processing functions](#processing-functions)
- [Transport factories](#transport-factories)
- [Pre-connecting transports](#pre-connecting-transports)
- [Utilities](#utilities)
- [Classes](#classes)
- [TransportStream interface](#transportstream-interface)

## Processing functions

### processAIStream(stream, [websocketUrl], [options])

Sends the stream's text chunks as T.140 over a WebSocket.

- `stream` — the streaming data source.
- `websocketUrl` `string` — optional, defaults to `ws://localhost:8765`.
- `options` `object` — optional: `handleMetadata`, `metadataCallback`, `sendMetadataOverWebsocket`, `processBackspaces`.
- returns `void`.

### processAIStreamToRtp(stream, remoteAddress, [remotePort], [rtpConfig])

Sends text chunks directly as T.140 over RTP. With FEC enabled, adds Forward Error Correction packets per RFC 5109. A custom transport, if provided, replaces the default UDP socket.

- `remoteAddress` `string` — remote IP (ignored when a custom transport is set).
- `remotePort` `number` — optional, defaults to `5004`.
- `rtpConfig` `RtpConfig` — optional:
  - `payloadType` `number` — default `96`.
  - `ssrc` `number` — default: a cryptographically secure random value.
  - `initialSequenceNumber` `number` — default `0`.
  - `initialTimestamp` `number` — default `0`.
  - `timestampIncrement` `number` — default `160`.
  - `fecEnabled` `boolean` — default `false`.
  - `fecPayloadType` `number` — default `97`.
  - `fecGroupSize` `number` — media packets protected per FEC packet, default `3`.
  - `redEnabled` `boolean` — enable T.140 redundancy.
  - `customTransport` `TransportStream` — replaces the UDP socket.
- returns `T140RtpTransport`.

### processAIStreamToSrtp(stream, remoteAddress, [remotePort], srtpConfig)

Same as `processAIStreamToRtp`, but encrypts with SRTP.

- `remotePort` `number` — optional, defaults to `5006`.
- `srtpConfig` `SrtpConfig`:
  - `masterKey` `Buffer` — required.
  - `masterSalt` `Buffer` — required.
  - `profile` `SrtpProtectionProfile` — optional (valid `0x0001`–`0x0008`).
  - `customTransport` `TransportStream` — optional.
- returns `T140RtpTransport`.

### processAIStreamToDirectSocket(stream, [socketPath], [rtpConfig])

Sends RTP-framed T.140 straight to a Unix SEQPACKET socket, skipping the WebSocket hop.

- `socketPath` `string` — optional, defaults to the library's default socket path.
- `rtpConfig` `RtpConfig` — optional, same options as `processAIStreamToRtp`.
- returns `T140RtpTransport`.

### processAIStreamsToMultiplexedRtp(streams, remoteAddress, [remotePort], [rtpConfig])

Combines multiple streams into one multiplexed RTP output.

- `streams` `Map<string, TextDataStream>` — stream IDs to streams.
- `remotePort` `number` — optional, defaults to `5004`.
- `rtpConfig` `RtpConfig` — optional, plus:
  - `multiplexEnabled` `boolean` — **required**, set `true`.
  - `useCsrcForStreamId` `boolean` — use the RTP CSRC field for stream IDs (recommended), default `false`.
  - `charRateLimit` `number` — combined character rate limit, default `30`.
- returns `T140RtpMultiplexer`.

## Transport factories

Each factory creates a transport up front and returns an `attachStream(stream, [options])` function, letting you connect before the LLM stream exists. See [Pre-connecting transports](#pre-connecting-transports).

### createT140WebSocketTransport(websocketUrl, [options])

- `websocketUrl` `string` — optional, defaults to `ws://localhost:8765`.
- `options.tlsOptions` `object` — optional TLS options for secure WebSocket.
- returns `{ connection, attachStream }`.

### createDirectSocketTransport(socketPath, [rtpConfig])

- returns `{ transport, attachStream, rtpState }` where `rtpState` is `{ sequenceNumber, timestamp, ssrc }`.

### createT140RtpTransport(remoteAddress, [remotePort], [rtpConfig])

- `remotePort` — optional, defaults to `5004`.
- returns `{ transport, attachStream }`.

### createT140SrtpTransport(remoteAddress, [remotePort], srtpConfig)

- `remotePort` — optional, defaults to `5006`.
- returns `{ transport, attachStream }`.

### createT140RtpMultiplexer(remoteAddress, [remotePort], [multiplexConfig])

- `multiplexConfig.multiplexEnabled` `boolean` — **required**, set `true`.
- `multiplexConfig.useCsrcForStreamId` `boolean` — optional, default `false`.
- returns `T140RtpMultiplexer`.

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

## Utilities

### createRtpPacket(sequenceNumber, timestamp, payload, [options])

Builds an RTP packet with a T.140 payload. `options` is `Partial<RtpConfig>`. Returns `Buffer`.

### createSrtpKeysFromPassphrase(passphrase)

Derives `{ masterKey, masterSalt }` from a passphrase. For production, use a stronger key derivation function and exchange keys securely.

## Classes

### T140RtpTransport

Manages an RTP/SRTP connection for sending T.140.

- `constructor(remoteAddress, [remotePort = 5004], [config])` — `config` accepts `RtpConfig`, including `customTransport`.
- `setupSrtp(srtpConfig)` — initializes SRTP. Returns `void`.
- `sendText(text)` — sends text as T.140, generating FEC packets when enabled. Returns `void`.
- `close()` — closes the socket/transport, flushing any remaining FEC packets. Returns `void`.

### T140RtpMultiplexer

Multiplexes multiple LLM streams into one RTP output.

- `constructor(remoteAddress, [remotePort = 5004], [config])`.
- `addStream(id, stream, [streamConfig], [processorOptions])` — returns `boolean`.
- `removeStream(id)` — returns `boolean`.
- `getStreamCount()` — returns `number`.
- `getStreamIds()` — returns `string[]`.
- `close()` — closes the multiplexer and all streams.

**Events:** `streamAdded`, `streamRemoved`, `streamError`, `metadata`, `error`.

### T140StreamDemultiplexer

Extracts individual streams from multiplexed RTP packets on the receiving end.

- `constructor()`.
- `processPacket(data, [useCSRC = false])` — parses an RTP packet and routes it. Returns `void`.
- `getStream(streamId)` — returns `DemultiplexedStream | undefined`.
- `getStreamIds()` — returns `string[]`.

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

## TransportStream interface

Implement this to plug in your own transport (WebRTC data channel, custom socket, steganographic carrier, …). Anything satisfying it can be passed as `customTransport`.

- `send(data, [callback])` — sends a `Buffer`; `callback(error?)` fires on completion. Returns `void`.
- `close()` — optional; releases resources. Returns `void`.

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
