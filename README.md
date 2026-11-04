<div align="center">

  ![T140LLM](logo.gif)

  <h1 style="border-bottom: none;">t140llm</h1>

  [![npm version](https://img.shields.io/npm/v/t140llm)](https://www.npmjs.com/package/t140llm)
  [![npm downloads](https://img.shields.io/npm/dm/t140llm)](https://www.npmjs.com/package/t140llm)
  [![license](https://img.shields.io/npm/l/t140llm)](https://mit-license.org/)

  <p>Convert LLM streaming responses into <a href="https://www.itu.int/rec/T-REC-T.140">T.140</a> real-time text for SIP, WebRTC, and (S)RTP.</p>

</div>

---

`t140llm` takes a streaming response from any LLM SDK and emits it as [ITU-T T.140](https://www.itu.int/rec/T-REC-T.140) real-time text, character by character as the tokens arrive, over WebSocket, RTP, SRTP, or a Unix socket. It's the bridge between a modern chat completion stream and the real-time text infrastructure used by SIP, WebRTC, TTY/telecommunications relay, and assistive devices.

## Why T.140?

T.140 is the standard for transmitting text over IP as it is being written, rather than after the full message is composed. That makes it a good fit for low-latency and lossy links: accessibility services, TTY relays, noisy radio, even satellite. On those links you want each character on the wire immediately. The RTP pipeline uses an event-driven send model that delivers characters with sub-millisecond latency (avg ~0.1 ms in the [included benchmark](examples/latency_benchmark.js)), versus ~50 ms for fixed-interval polling.

What the standard gives you that a WebSocket of raw strings does not:

- **Any RFC 4103 endpoint can receive it.** SIP phones, WebRTC gateways, TTY relay services, and accessibility terminals already speak `text/t140` and `text/red`. The far end needs no SDK.
- **Loss recovery is on by default.** Every packet carries the previous two text blocks again ([RFC 2198](https://www.rfc-editor.org/rfc/rfc2198) redundancy, the [RFC 4103 §4](https://www.rfc-editor.org/rfc/rfc4103#section-4) default). A receiver loses text only when three packets in a row go missing. After the LLM stops, the transport keeps re-sending the last block until it has gone out with full redundancy, so the end of the answer is protected too.
- **Editing is part of the format.** T.140 has a backspace, so a model that corrects itself mid-stream erases on the reader's screen instead of appending noise.
- **Receivers can pace and detect gaps.** The marker bit flags the first packet after a pause, 1000 Hz timestamps say when each block was entered, sequence numbers reveal loss, and the `cps` rate limit (default 30 characters per second) keeps PSTN gateways from overflowing.

### Standards

| Behavior | Follows | Notes |
| --- | --- | --- |
| RTP header, SSRC, sequence numbers | [RFC 3550](https://www.rfc-editor.org/rfc/rfc3550) | One SSRC and one sequence space per transport |
| `text/t140` payload, 1000 Hz clock, M-bit, idle handling, `cps` | [RFC 4103](https://www.rfc-editor.org/rfc/rfc4103) §3, §5, §6 | Buffering interval is 100 ms, not the recommended 300 ms: lower latency, more packets |
| Redundancy, on by default | [RFC 2198](https://www.rfc-editor.org/rfc/rfc2198) as profiled by RFC 4103 §4 | Oldest block first. Blocks older than 16383 ms are dropped. Set `redEnabled: false` for plain text/t140 |
| Forward error correction (`fecEnabled`) | [RFC 5109](https://www.rfc-editor.org/rfc/rfc5109) §7 | Sent in the same session as the media, which RFC 5109 §14.1 says to avoid; not available together with SRTP |
| SRTP | [RFC 3711](https://www.rfc-editor.org/rfc/rfc3711) | Profiles `0x0001` and `0x0007` |
| SRTP key management | [RFC 5764](https://www.rfc-editor.org/rfc/rfc5764) DTLS-SRTP | The automatic key management RFC 3711 §9.1 requires. Handshake and media share one UDP 5-tuple |
| Multiplexing (`processAIStreamsToMultiplexedRtp`) | library convention | CSRC tags or an in-payload prefix; needs `T140StreamDemultiplexer` on the far end |

## Install

```sh
npm install t140llm
```

Requires Node.js >= 16.

## Quick start

Pass any LLM SDK's streaming response straight to `processAIStream`:

```typescript
import { processAIStream } from "t140llm";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

// Emits T.140 over WebSocket (default ws://localhost:8765)
processAIStream(stream);
```

Streams are consumed as-is. EventEmitters and async iterables (the shape most SDKs return) both work, with no wrapping required. To send T.140 straight to an RTP endpoint instead of a WebSocket:

```typescript
import { processAIStreamToRtp } from "t140llm";

const transport = processAIStreamToRtp(stream, "192.168.1.100", 5004);
// transport.close() when done
```

For encrypted delivery with no key material to manage, let DTLS negotiate the keys:

```typescript
import { processAIStreamToDtlsSrtp } from "t140llm";

const transport = await processAIStreamToDtlsSrtp(stream, "192.168.1.100", 5006);
```

That's the whole surface: create a streaming completion, hand it to a `processAIStream*` function. See the [provider guide](docs/providers.md) for OpenAI, Anthropic, Google Gemini, Mistral, Cohere, Ollama, and the Vercel AI SDK.

## Transports

| Function | Output | Notes |
| --- | --- | --- |
| `processAIStream` | WebSocket | Default; T.140 over `ws://` |
| `processAIStreamToRtp` | RTP over UDP | Optional redundancy (RFC 2198) and [FEC](docs/api.md) (RFC 5109) |
| `processAIStreamToSrtp` | Encrypted SRTP | Keys you supply or derive from a passphrase |
| `processAIStreamToDtlsSrtp` | Encrypted SRTP | Keys negotiated over the wire (DTLS-SRTP, RFC 5764) |
| `processAIStreamToDirectSocket` | Unix SEQPACKET socket | No WebSocket hop, still RTP-framed |
| `processAIStreamsToMultiplexedRtp` | One RTP stream, many LLMs | CSRC-tagged; demux on the far end |

Every transport can be [pre-connected](docs/api.md#pre-connecting-transports) before the stream exists (to cut startup latency) and can run over a [custom transport](docs/api.md#transportstream-interface) (WebRTC data channel, steganographic carrier, etc.).

## Capabilities

- [x] T.140 RTP payload formatting, with redundancy on by default (RFC 2198, RFC 4103 section 4)
- [x] Forward error correction (RFC 5109) as an alternative to redundancy
- [x] SRTP with automatic key management over DTLS-SRTP (RFC 5764), no shared secret needed
- [x] (S)RTP direct delivery with configurable rate limiting / token pooling
- [x] Custom transport streams (WebRTC, custom protocols)
- [x] Unix SEQPACKET (multi-stream) and STREAM (single-stream) sockets
- [x] WebSocket transport
- [x] Stream multiplexing: combine multiple LLM streams into one RTP output
- [x] Direct async-iterable support: pass SDK streams with no EventEmitter wrapping
- [x] Reasoning and output-metadata handling
- [x] T.140 backspace processing
- [x] Receive-side helpers: RED parsing and T.140 text extraction
- [x] Steganography: hide RTP packets inside cover media, via [llm-steg](https://github.com/agrathwohl/llm-steg) ([guide](docs/steganography.md))

**Provider support:** Vercel AI SDK · Anthropic · OpenAI · Cohere · Mistral · Google Gemini · Ollama · reasoning streams · tool calls. See the [provider guide](docs/providers.md).

## Examples

Runnable demos in [`examples/`](examples/):

| Demo | What it shows |
| --- | --- |
| [`demo.js`](examples/demo.js) | Same stream over WebSocket, RTP, SRTP, and a direct socket, side by side |
| [`latency_benchmark.js`](examples/latency_benchmark.js) | Chunk-to-wire latency for the EventEmitter and async-iterable paths |
| [`fec_demo.js`](examples/fec_demo.js) | Forward Error Correction recovering from simulated packet loss |
| [`multiplexed_streams_example.js`](examples/multiplexed_streams_example.js) | Multiplexing several LLM streams into one RTP output |
| [`baudot_ita2_tty_example.js`](examples/baudot_ita2_tty_example.js) | Transcoding T.140 to 5-bit Baudot/ITA2 for a TTY/telegraph line |
| [`steganography/`](examples/steganography/) | Hiding RTP packets inside cover media |

See [`examples/README.md`](examples/README.md) for how to run each one.

## Documentation

- [Provider guide](docs/providers.md): every supported LLM SDK
- [API reference](docs/api.md): all functions, classes, and config options
- [Types & interfaces](docs/types.md): `RtpConfig`, `SrtpConfig`, `TransportStream`, errors, metadata
- [Steganography](docs/steganography.md): hide RTP packets in cover media
- [Full docs site](https://agrathwohl.github.io/t140llm/)

## License

[MIT](https://mit-license.org/) © agrathwohl
