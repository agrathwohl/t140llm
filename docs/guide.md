# Overview

> Convert LLM streaming responses into [T.140](https://www.itu.int/rec/T-REC-T.140) real-time text for SIP, WebRTC, and (S)RTP.

`t140llm` takes a streaming response from any LLM SDK and emits it as ITU-T T.140 real-time text, character by character as the tokens arrive, over WebSocket, RTP, SRTP, or a Unix socket. It's the bridge between a modern chat completion stream and the real-time text infrastructure used by SIP, WebRTC, TTY/telecommunications relay, and assistive devices.

## Install

```sh
npm install t140llm
```

Requires Node.js >= 16.

## Quick start

```typescript
import { processAIStream } from "t140llm";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

processAIStream(stream); // T.140 over WebSocket (ws://localhost:8765)
```

Or send straight to an RTP endpoint:

```typescript
import { processAIStreamToRtp } from "t140llm";

const transport = processAIStreamToRtp(stream, "192.168.1.100", 5004);
// transport.close() when done
```

Streams are consumed as-is. EventEmitters and async iterables both work, with no wrapping required. The create-stream / hand-to-`processAIStream*` pattern is the whole surface; see the [provider guide](/providers) for every supported SDK.

## Why T.140?

T.140 transmits text over IP as it is being written, rather than after the full message is composed. That is a good fit for low-latency and lossy links (accessibility services, TTY relays, noisy radio, satellite). The RTP pipeline uses an event-driven send model with sub-millisecond chunk-to-wire latency (avg ~0.1 ms in the [included benchmark](https://github.com/agrathwohl/t140llm/blob/master/examples/latency_benchmark.js)).

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
| SRTP key management | [RFC 5764](https://www.rfc-editor.org/rfc/rfc5764) DTLS-SRTP | The automatic key management RFC 3711 §9.1 requires |
| Multiplexing (`processAIStreamsToMultiplexedRtp`) | library convention | CSRC tags or an in-payload prefix; needs `T140StreamDemultiplexer` on the far end |

## Transports

| Function | Output | Notes |
| --- | --- | --- |
| `processAIStream` | WebSocket | Default; T.140 over `ws://` |
| `processAIStreamToRtp` | RTP over UDP | Optional redundancy (RFC 2198) and FEC (RFC 5109) |
| `processAIStreamToSrtp` | Encrypted SRTP | Keys you supply or derive from a passphrase |
| `processAIStreamToDtlsSrtp` | Encrypted SRTP | Keys negotiated over the wire (DTLS-SRTP, RFC 5764) |
| `processAIStreamToDirectSocket` | Unix SEQPACKET socket | No WebSocket hop, still RTP-framed |
| `processAIStreamsToMultiplexedRtp` | One RTP stream, many LLMs | CSRC-tagged; demux on the far end |

Every transport can be [pre-connected](/api#pre-connecting-transports) before the stream exists (to cut startup latency) and can run over a [custom transport](/api#transportstream-interface) (WebRTC data channel, steganographic carrier, etc.).

## How it works

**WebSocket mode**: text chunks arrive over a WebSocket, get encapsulated as T.140 in RTP packets, and are written to a Unix SEQPACKET socket your application reads from.

**Direct RTP mode**: each chunk is packaged as T.140 in an RTP packet and sent over UDP to the target address. With FEC enabled, XOR-based FEC packets (RFC 5109) are generated per group so receivers can recover from loss.

**Secure SRTP mode**: the same RTP flow, encrypted with SRTP using the keys you supply.

## Next steps

- [Provider guide](/providers): OpenAI, Anthropic, Gemini, Mistral, Cohere, Ollama, Vercel AI SDK
- [API reference](/api): all functions, classes, and config
- [Types & interfaces](/types): [`RtpConfig`](/types#rtpconfig), [`SrtpConfig`](/types#srtpconfig), [`TransportStream`](/types#transportstream), errors, metadata
- [Steganography](/steganography): hide RTP packets in cover media
- [Examples](/examples): runnable demos
