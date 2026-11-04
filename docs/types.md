# Types & interfaces

Every interface and type below is exported from the package root (`import { RtpConfig } from "t140llm"`) unless noted otherwise. Steganography types live in a separate module. See [Steganography](/steganography).

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

The input every processor accepts. An **EventEmitter** emits `data`, `end`, `error`, and optionally `metadata` events; an **AsyncIterable** yields chunks (the shape most LLM SDK streams return). Both are consumed directly, with no wrapping.

## RtpConfig

The configuration object shared by every RTP/SRTP transport. All fields are optional.

| Field | Type | Meaning |
| --- | --- | --- |
| `payloadType` | `number` | RTP payload type (default `96`) |
| `ssrc` | `number` | Synchronization source (default: secure random) |
| `initialSequenceNumber` | `number` | Starting sequence number (default `0`) |
| `initialTimestamp` | `number` | Starting timestamp (default `0`) |
| `timestampIncrement` | `number` | Fixed timestamp increment per packet. Default: 1000 Hz wall clock (RFC 4103 §3) |
| `fecEnabled` | `boolean` | Enable Forward Error Correction (RFC 5109) |
| `fecPayloadType` | `number` | Payload type for FEC packets (default `97`) |
| `fecGroupSize` | `number` | Media packets protected per FEC packet (default `3`) |
| `processBackspaces` | `boolean` | Enable T.140 backspace processing |
| `charRateLimit` | `number` | Character rate limit, characters per second (default `30`) |
| `redEnabled` | `boolean` | T.140 redundancy, text/red (default `true`, RFC 4103 §4) |
| `redPayloadType` | `number` | Payload type for RED encoding |
| `redundancyLevel` | `number` | Redundant T.140 blocks per packet (default `2`) |
| `customTransport` | [`TransportStream`](/types#transportstream) | Use instead of the default UDP socket |
| `handleMetadata` | `boolean` | Detect and process LLM metadata |
| `metadataCallback` | `(m: LLMMetadata) => void` | Called for each metadata item |
| `sendMetadataAsPackets` | `boolean` | Send metadata as separate RTP packets |
| `metadataPayloadType` | `number` | Payload type for metadata packets (default `99`) |
| `onError` | `(error: Error) => void` | Called when the source stream fails |
| `multiplexEnabled` | `boolean` | Enable multiplexing multiple streams |
| `streamIdentifier` | `string` | Unique ID for this stream in a multiplex |
| `csrcList` | `number[]` | Contributing source identifiers |
| `useCsrcForStreamId` | `boolean` | Use the CSRC field for stream identification |
| `markerBit` | `boolean` | Set the RTP marker bit (RFC 4103 §3: first packet after idle) |
| `bomPrewarm` | `boolean` | Send a BOM (U+FEFF) on transport creation to open NAT pinholes |

## SrtpConfig

Extends [`RtpConfig`](/types#rtpconfig) (minus `charRateLimit`) with the SRTP key material.

| Field | Type | Meaning |
| --- | --- | --- |
| `masterKey` | `Buffer` | **Required.** SRTP master key, 16 bytes |
| `masterSalt` | `Buffer` | **Required.** SRTP master salt, 14 bytes |
| `profile` | [`SrtpProtectionProfile`](/types#srtpprotectionprofile) | Crypto profile (default profile 1) |
| `remoteMasterKey` | `Buffer` | Receive-direction key. Defaults to `masterKey` |
| `remoteMasterSalt` | `Buffer` | Receive-direction salt. Defaults to `masterSalt` |
| `isSRTCP` | `boolean` | Treat as SRTCP (default `false`) |

### SrtpProtectionProfile

The two profiles that the bundled SRTP implementation supports, numbered per the [IANA SRTP registry](https://www.iana.org/assignments/srtp-protection/srtp-protection.xhtml):

| Value | Profile |
| --- | --- |
| `0x0001` | `SRTP_AES128_CM_HMAC_SHA1_80` (default) |
| `0x0007` | `SRTP_AEAD_AES_128_GCM` |

## DtlsSrtpOptions

Passed as `config.dtls` to [`processAIStreamToDtlsSrtp`](/api#processaistreamtodtlssrtp-stream-remoteaddress-remoteport-config), or directly to `negotiateDtlsSrtp`.

| Field | Type | Meaning |
| --- | --- | --- |
| `role` | `'client' \| 'server'` | `client` sends the ClientHello (default) |
| `certPem` | `string` | Certificate PEM. A self-signed ECDSA certificate is generated when omitted |
| `keyPem` | `string` | Private key PEM, required with `certPem` |
| `profiles` | [`SrtpProtectionProfile`](/types#srtpprotectionprofile)`[]` | Profiles to offer, most preferred first |
| `localPort` | `number` | Local UDP port to bind. Default: ephemeral |
| `handshakeTimeoutMs` | `number` | Give up after this long (default `10000`) |
| `certificateRequest` | `boolean` | Server role: ask the client for a certificate (default `false`) |
| `socket` | `dgram.Socket` | Reuse an existing bound socket |
| `onRtpPacket` | `(packet: Buffer, remote) => void` | Inbound (S)RTP on the shared port |
| `verifyRemoteCertificate` | `(cert?: Buffer) => void` | Throw to reject the peer |

## DtlsSrtpSession

| Field | Type | Meaning |
| --- | --- | --- |
| `masterKey` | `Buffer` | Send-direction key, 16 bytes |
| `masterSalt` | `Buffer` | Send-direction salt, 14 or 12 bytes by profile |
| `remoteMasterKey` | `Buffer` | Receive-direction key |
| `remoteMasterSalt` | `Buffer` | Receive-direction salt |
| `profile` | [`SrtpProtectionProfile`](/types#srtpprotectionprofile) | The profile both sides agreed on |
| `remoteCertificate` | `Buffer` | The peer's certificate, for fingerprint checks |
| `transport` | [`TransportStream`](/types#transportstream) | Sends SRTP on the same 5-tuple |
| `localAddress` | `AddressInfo` | Local address and port of the shared socket |
| `close()` | `() => void` | Closes the DTLS session and the socket |

## ParsedRedPacket

Returned by [`parseT140RedPacket`](/api#parset140redpacket-packet).

| Field | Type | Meaning |
| --- | --- | --- |
| `payloadType` | `number` | Payload type from the RTP header |
| `sequenceNumber` | `number` | RTP sequence number |
| `timestamp` | `number` | RTP timestamp, 1000 Hz |
| `ssrc` | `number` | Synchronization source |
| `marker` | `boolean` | M-bit, set on the first packet after idle |
| `redundant` | `RedBlock[]` | Earlier blocks, oldest first |
| `primary` | `string` | The new text in this packet |

Each `RedBlock` has `payloadType`, `timestampOffset` (milliseconds before the packet timestamp), and `text`.

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
