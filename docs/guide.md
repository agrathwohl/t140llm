# Overview

> Convert LLM streaming responses into [T.140](https://www.itu.int/rec/T-REC-T.140) real-time text for SIP, WebRTC, and (S)RTP.

`t140llm` takes a streaming response from any LLM SDK and emits it as ITU-T T.140 real-time text — character by character, as the tokens arrive — over WebSocket, RTP, SRTP, or a Unix socket. It's the bridge between a modern chat completion stream and the real-time text infrastructure used by SIP, WebRTC, TTY/telecommunications relay, and assistive devices.

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

Streams are consumed as-is — EventEmitters and async iterables both work, no wrapping required. The create-stream / hand-to-`processAIStream*` pattern is the whole surface; see the [provider guide](/providers) for every supported SDK.

## Why T.140?

T.140 transmits text over IP as it is being written, rather than after the full message is composed — a good fit for low-latency and lossy links (accessibility services, TTY relays, noisy radio, satellite). The RTP pipeline uses an event-driven send model with sub-millisecond chunk-to-wire latency (avg ~0.1 ms in the [included benchmark](https://github.com/agrathwohl/t140llm/blob/master/examples/latency_benchmark.js)).

## Transports

| Function | Output | Notes |
| --- | --- | --- |
| `processAIStream` | WebSocket | Default; T.140 over `ws://` |
| `processAIStreamToRtp` | RTP over UDP | Optional FEC (RFC 5109) and redundancy |
| `processAIStreamToSrtp` | Encrypted SRTP | Keys from passphrase or your own |
| `processAIStreamToDirectSocket` | Unix SEQPACKET socket | No WebSocket hop, still RTP-framed |
| `processAIStreamsToMultiplexedRtp` | One RTP stream, many LLMs | CSRC-tagged; demux on the far end |

Every transport can be [pre-connected](/api#pre-connecting-transports) before the stream exists (to cut startup latency) and can run over a [custom transport](/api#transportstream-interface) (WebRTC data channel, steganographic carrier, etc.).

## How it works

**WebSocket mode** — text chunks arrive over a WebSocket, get encapsulated as T.140 in RTP packets, and are written to a Unix SEQPACKET socket your application reads from.

**Direct RTP mode** — each chunk is packaged as T.140 in an RTP packet and sent over UDP to the target address. With FEC enabled, XOR-based FEC packets (RFC 5109) are generated per group so receivers can recover from loss.

**Secure SRTP mode** — the same RTP flow, encrypted with SRTP using the keys you supply.

## Next steps

- [Provider guide](/providers) — OpenAI, Anthropic, Gemini, Mistral, Cohere, Ollama, Vercel AI SDK
- [API reference](/api) — all functions, classes, and config
- [Types & interfaces](/types) — `RtpConfig`, `SrtpConfig`, `TransportStream`, errors, metadata
- [Steganography](/steganography) — hide RTP packets in cover media
- [Examples](/examples) — runnable demos
