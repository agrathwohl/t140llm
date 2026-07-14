# Steganography

The steganography module hides RTP packets inside cover media (images, audio, or other buffers) before they go on the wire. The encoding algorithm can be a built-in fixed algorithm or one generated at runtime by an LLM.

It ships as a **separate, optional module** — it is deliberately not re-exported from the package root, so the main entry point stays free of LLM dependencies. Import it from the steganography build:

```typescript
import {
  processAIStreamToStegRtp,
  createStegT140RtpTransport,
  StegTransport,
} from "t140llm/dist/steganography";
```

## Quick start

`processAIStreamToStegRtp` mirrors `processAIStreamToRtp`, plus a `steganography` config block:

```typescript
import { processAIStreamToStegRtp } from "t140llm/dist/steganography";

const transport = processAIStreamToStegRtp(stream, "192.168.1.100", 5004, {
  steganography: {
    enabled: true,
    encodeMode: "fixed",       // or "llm" to generate the algorithm at runtime
    coverMedia: [imageBuffer], // buffers to hide packets inside
    encodingRatio: 100,        // percent of each packet to encode
  },
});
// transport.close() when done
```

## StegConfig

Set on `RtpConfigWithSteg.steganography`.

| Field | Type | Meaning |
| --- | --- | --- |
| `enabled` | `boolean` | **Required.** Turn steganography on |
| `encodeMode` | `'llm' \| 'fixed'` | **Required.** Generate the algorithm with an LLM, or use a built-in one |
| `coverMedia` | `Buffer[]` | Cover media (image/audio/other) to hide data in |
| `prompt` | `string` | LLM prompt for algorithm generation (`encodeMode: 'llm'`) |
| `algorithm` | `string` | Pre-generated algorithm code (`encodeMode: 'fixed'`) |
| `seed` | `string` | Random seed for deterministic algorithm generation |
| `encodingRatio` | `number` | Percent of each packet to encode (0–100, default `100`) |
| `llmProvider` | `unknown` | Custom LLM provider; falls back to OpenAI when omitted |

### RtpConfigWithSteg

```typescript
interface RtpConfigWithSteg extends RtpConfig {
  steganography?: StegConfig;
}
```

Everything from [`RtpConfig`](/types#rtpconfig) applies, plus the `steganography` block.

## Functions

### createStegT140RtpTransport(remoteAddress, [remotePort], [config])

Creates a `T140RtpTransport` whose packets are steganographically encoded before sending. When `config.steganography.enabled` is false, it behaves like a plain RTP transport. Returns `T140RtpTransport`.

### processAIStreamToStegRtp(stream, remoteAddress, [remotePort], [config])

Convenience wrapper: builds a steganographic transport and pipes an AI stream into it. Returns `T140RtpTransport`.

## StegTransport

The `TransportStream` wrapper that performs the encoding. Construct it around any inner transport to add steganography to a transport you already have:

```typescript
import { StegTransport } from "t140llm/dist/steganography";

const steg = new StegTransport(innerTransport, {
  enabled: true,
  encodeMode: "fixed",
  coverMedia: [coverBuffer],
});
```

It implements `StegTransportInterface`:

| Method | Purpose |
| --- | --- |
| `send(data, callback?)` | Encode `data` into cover media, then send via the inner transport |
| `close?()` | Close the inner transport |
| `encode(data, cover)` | Hide `data` inside `cover`, returning the modified cover |
| `decode(stegData)` | Extract the hidden data from a steganographic buffer |
| `getConfig()` | Return the current `StegConfig` |
| `updateConfig(partial)` | Merge new settings into the config |

## Examples

- [`examples/steganography/llm_steg_example.js`](https://github.com/agrathwohl/t140llm/blob/master/examples/steganography/llm_steg_example.js) — LLM-generated encoding algorithm
- [`examples/steganography/custom_steg_transport_example.js`](https://github.com/agrathwohl/t140llm/blob/master/examples/steganography/custom_steg_transport_example.js) — custom steganographic transport
- [`examples/steganography/README.md`](https://github.com/agrathwohl/t140llm/blob/master/examples/steganography/README.md) — full walkthrough
