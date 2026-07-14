# Types & interfaces

Every interface and type below is exported from the package root (`import { RtpConfig } from "t140llm"`) unless noted otherwise. Steganography types live in a separate module — see [Steganography](/steganography).

- [Streams](#streams)
- [RtpConfig](#rtpconfig)
- [SrtpConfig](#srtpconfig)
- [TransportStream](#transportstream)
- [Processor options](#processor-options)
- [Metadata](#metadata)
- [Errors](#errors)
- [WebSocket options](#websocket-options)

## Streams

### TextDataStream

```typescript
type TextDataStream = EventEmitter | AsyncIterable<unknown>;
```

The input every processor accepts. An **EventEmitter** emits `data`, `end`, `error`, and optionally `metadata` events; an **AsyncIterable** yields chunks (the shape most LLM SDK streams return). Both are consumed directly — no wrapping.

## RtpConfig

The configuration object shared by every RTP/SRTP transport. All fields are optional.

| Field | Type | Meaning |
| --- | --- | --- |
| `payloadType` | `number` | RTP payload type (default `96`) |
| `ssrc` | `number` | Synchronization source (default: secure random) |
| `initialSequenceNumber` | `number` | Starting sequence number (default `0`) |
| `initialTimestamp` | `number` | Starting timestamp (default `0`) |
| `timestampIncrement` | `number` | Timestamp increment per packet (default `160`) |
| `fecEnabled` | `boolean` | Enable Forward Error Correction (RFC 5109) |
| `fecPayloadType` | `number` | Payload type for FEC packets (default `97`) |
| `fecGroupSize` | `number` | Media packets protected per FEC packet (default `3`) |
| `processBackspaces` | `boolean` | Enable T.140 backspace processing |
| `charRateLimit` | `number` | Character rate limit (chars/sec) |
| `redEnabled` | `boolean` | Enable T.140 redundancy (RED) |
| `redPayloadType` | `number` | Payload type for RED encoding |
| `redundancyLevel` | `number` | Number of redundant T.140 blocks to include |
| `customTransport` | [`TransportStream`](/types#transportstream) | Use instead of the default UDP socket |
| `handleMetadata` | `boolean` | Detect and process LLM metadata |
| `metadataCallback` | `(m: LLMMetadata) => void` | Called for each metadata item |
| `sendMetadataAsPackets` | `boolean` | Send metadata as separate RTP packets |
| `metadataPayloadType` | `number` | Payload type for metadata packets |
| `multiplexEnabled` | `boolean` | Enable multiplexing multiple streams |
| `streamIdentifier` | `string` | Unique ID for this stream in a multiplex |
| `csrcList` | `number[]` | Contributing source identifiers |
| `useCsrcForStreamId` | `boolean` | Use the CSRC field for stream identification |
| `markerBit` | `boolean` | Set the RTP marker bit (RFC 4103 §5.1 M-bit, first packet after idle) |
| `bomPrewarm` | `boolean` | Send BOM (U+FEFF) on transport creation to open NAT pinholes (RFC 4103) |

## SrtpConfig

Extends [`RtpConfig`](/types#rtpconfig) (minus `charRateLimit`) with the SRTP key material.

| Field | Type | Meaning |
| --- | --- | --- |
| `masterKey` | `Buffer` | **Required.** SRTP master key |
| `masterSalt` | `Buffer` | **Required.** SRTP master salt |
| `profile` | [`SrtpProtectionProfile`](/types#srtpprotectionprofile) | Crypto profile (default profile 1) |
| `isSRTCP` | `boolean` | Treat as SRTCP (default `false`) |

### SrtpProtectionProfile

Valid values per the [IANA SRTP registry](https://www.iana.org/assignments/srtp-protection/srtp-protection.xhtml):

| Value | Profile |
| --- | --- |
| `0x0001` | `SRTP_AES128_CM_HMAC_SHA1_80` |
| `0x0002` | `SRTP_AES128_CM_HMAC_SHA1_32` |
| `0x0005` | `SRTP_AEAD_AES_128_GCM` |
| `0x0006` | `SRTP_AEAD_AES_256_GCM` |
| `0x0007` | `DOUBLE_AEAD_AES_128_GCM_AEAD_AES_128_GCM` |
| `0x0008` | `DOUBLE_AEAD_AES_256_GCM_AEAD_AES_256_GCM` |

## TransportStream

Implement this to plug in a custom transport (WebRTC data channel, steganographic carrier, etc.). Pass it as `RtpConfig.customTransport`.

```typescript
interface TransportStream {
  send(data: Buffer, callback?: (error?: Error) => void): void;
  close?(): void;
}
```

## Processor options

Passed as the third argument to `processAIStream` and to `attachStream` on pre-created transports.

```typescript
interface ProcessorOptions {
  processBackspaces?: boolean;
  handleMetadata?: boolean;
  metadataCallback?: (metadata: LLMMetadata) => void;
  sendMetadataOverTransport?: boolean;
  onError?: (error: Error) => void;
  preCreateConnection?: boolean;
}
```

[`AttachStreamOptions`](/types#processor-options) extends this with `sendMetadataOverWebsocket?: boolean` and `tlsOptions?: TLSOptions`.

## Metadata

```typescript
interface LLMMetadata {
  type: 'tool_call' | 'tool_result' | 'custom' | 'reasoning' | string;
  content: unknown;
  id?: string;
}
```

Emitted for tool calls, tool results, reasoning, and custom provider metadata. Enable with `handleMetadata: true` and receive via `metadataCallback`. See [reasoning streams](/providers#reasoning-streams).

## Errors

[`T140RtpTransport`](/api#t140rtptransport) emits typed errors on its `error` event.

```typescript
interface T140RtpError {
  type: T140RtpErrorType;
  message: string;
  cause?: Error;
}
```

[`T140RtpErrorType`](/types#errors) is an enum:

| Value | When |
| --- | --- |
| `NETWORK_ERROR` | UDP socket / network failures |
| `ENCRYPTION_ERROR` | SRTP encryption failures |
| `FEC_ERROR` | FEC packet creation failures |
| `INVALID_CONFIG` | Invalid or missing configuration |
| `RATE_LIMIT_ERROR` | Rate-limit handling failures |
| `RESOURCE_ERROR` | Socket allocation/deallocation failures |

```typescript
import { T140RtpErrorType } from "t140llm";

transport.on("error", (err) => {
  if (err.type === T140RtpErrorType.NETWORK_ERROR) { /* ... */ }
});
```

## WebSocket options

```typescript
interface TLSOptions {
  rejectUnauthorized?: boolean;
  ca?: string;
  cert?: string;
  key?: string;
}

interface WebSocketOptions {
  tlsOptions?: TLSOptions;
}
```
