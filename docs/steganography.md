# Steganography

The steganography module hides RTP packets inside cover media (images, audio, or other buffers) before they go on the wire. Encoding is performed by [llm-steg](https://github.com/agrathwohl/llm-steg), a transport-agnostic steganography library.

Steganography is obfuscation, not confidentiality. Combine it with SRTP when the text must stay secret.

It ships as a **separate, optional module**. It is deliberately not re-exported from the package root, so the main entry point has no steganography dependency. Install the optional package, then import the module from its own build:

```sh
npm config set @agrathwohl:registry https://npm.pkg.github.com
# a GitHub token with the read:packages scope is required
NODE_AUTH_TOKEN=<token> npm install @agrathwohl/llm-steg
```

```typescript
import {
  processAIStreamToStegRtp,
  createStegT140RtpTransport,
  StegTransport,
} from "t140llm/dist/steganography";
```

`@agrathwohl/llm-steg` is an `optionalDependency`, so `npm install t140llm` succeeds without it. Importing this module without it throws a module-not-found error.

## Quick start

`processAIStreamToStegRtp` mirrors `processAIStreamToRtp`, plus a `steganography` config block:

```typescript
import { processAIStreamToStegRtp } from "t140llm/dist/steganography";

const transport = processAIStreamToStegRtp(stream, "192.168.1.100", 5004, {
  steganography: {
    enabled: true,
    algorithm: "lsb",          // least significant bit, from llm-steg
    coverMedia: [imageBuffer], // buffers to hide packets inside, used round-robin
    onError: "throw",          // or "passthrough" / "drop"
  },
});
// transport.close() when done
```

## StegConfig

Set on `RtpConfigWithSteg.steganography`.

| Field | Type | Meaning |
| --- | --- | --- |
| `enabled` | `boolean` | Turn steganography on (default `true`) |
| `algorithm` | `'lsb'` | Encoding algorithm (default `'lsb'`) |
| `coverMedia` | `Buffer[]` | Buffers to hide packets inside, used round-robin. For LSB each buffer needs at least 8 times the packet size plus 4 bytes |
| `seed` | `string` | Seed for deterministic encoding. Random when omitted |
| `onError` | `'passthrough' \| 'throw' \| 'drop'` | What to do when a packet cannot be encoded (default `'throw'`) |
| `debug` | `boolean` | Log encode and decode operations (default `false`) |
| `encodeMode` | `'fixed'` | **Deprecated.** Only `'fixed'` is accepted and it is the default. The `'llm'` mode evaluated generated code at runtime and was removed |
| `encodingRatio` | `number` | **Deprecated.** No longer used |

With `onError: 'throw'` and the default, a failed encode is reported through the `send` callback. `send` never throws, because the RTP send path calls it from a timer.

### RtpConfigWithSteg

```typescript
interface RtpConfigWithSteg extends RtpConfig {
  steganography?: StegConfig;
}
```

Everything from [`RtpConfig`](/types#rtpconfig) applies, plus the `steganography` block.

## Functions

### createStegT140RtpTransport(remoteAddress, [remotePort], [config])

Creates a [`T140RtpTransport`](/api#t140rtptransport) whose packets are steganographically encoded before sending. When `config.steganography.enabled` is false, it behaves like a plain RTP transport. Returns [`T140RtpTransport`](/api#t140rtptransport).

### processAIStreamToStegRtp(stream, remoteAddress, [remotePort], [config])

Convenience wrapper: builds a steganographic transport and pipes an AI stream into it. Returns [`T140RtpTransport`](/api#t140rtptransport).

## StegTransport

The [`TransportStream`](/types#transportstream) wrapper that performs the encoding. Construct it around any inner transport to add steganography to a transport you already have:

```typescript
import { StegTransport } from "t140llm/dist/steganography";

const steg = new StegTransport(innerTransport, {
  enabled: true,
  coverMedia: [coverBuffer],
});
```

It implements [`StegTransportInterface`](/steganography#stegtransport):

| Method | Purpose |
| --- | --- |
| `send(data, callback?)` | Encode `data` into cover media, then send via the inner transport |
| `close?()` | Close the inner transport |
| `encode(data, cover)` | Hide `data` inside `cover`, returning the modified cover |
| `decode(stegData)` | Extract the hidden data from a steganographic buffer |
| `getConfig()` | Return the current [`StegConfig`](/steganography#stegconfig) |
| `updateConfig(partial)` | Merge new settings into the config |

## Examples

- [`examples/steganography/llm_steg_example.js`](https://github.com/agrathwohl/t140llm/blob/master/examples/steganography/llm_steg_example.js) - LSB encoding with llm-steg
- [`examples/steganography/custom_steg_transport_example.js`](https://github.com/agrathwohl/t140llm/blob/master/examples/steganography/custom_steg_transport_example.js) - custom steganographic transport with bit-change analysis
- [`examples/steganography/README.md`](https://github.com/agrathwohl/t140llm/blob/master/examples/steganography/README.md) - full walkthrough
