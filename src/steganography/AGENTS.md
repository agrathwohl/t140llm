<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# steganography

## Purpose
Optional transport wrapper that hides outgoing RTP packets inside cover media buffers before the inner transport sends them. Encoding is done by `@agrathwohl/llm-steg`, declared as an `optionalDependency` because it is published to GitHub Packages and needs a token with the `read:packages` scope. The module is not re-exported from `../index.ts`, but it **is** compiled into `dist/steganography`, which is the documented import path.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Barrel for the five files below. |
| `steg-config.interface.ts` | `StegConfig`: `enabled` (default true), `algorithm` (`'lsb'`), `coverMedia`, `seed`, `onError` (`'passthrough' \| 'throw' \| 'drop'`, default `'throw'`), `debug`, plus deprecated `encodeMode: 'fixed'` and `encodingRatio`. |
| `steg-transport.interface.ts` | `StegTransportInterface extends TransportStream` with `encode(data, cover)`, `decode(stegData)`, `getConfig()`, `updateConfig(partial)`. |
| `steg-transport.ts` | `class StegTransport implements StegTransportInterface`. Constructor `(innerTransport, config)` throws when `encodeMode === 'llm'` (removed because it ran generated code through `eval`). Forces `encodeMode: 'fixed'`, fills defaults, and seeds a random value with `crypto.randomBytes`. `send` passes data through unchanged when steganography is disabled or no cover media exists; otherwise it picks a random cover buffer with `crypto.randomBytes`, calls `encode`, and forwards the result. On an encode error it calls the callback and rethrows. |
| `rtp-config-extensions.ts` | `RtpConfigWithSteg extends RtpConfig { steganography?: StegConfig }`. |
| `transport-factory.ts` | `createStegT140RtpTransport(address, port, config)` builds a UDP `TransportStream` (or uses `config.customTransport`), wraps it in `StegTransport` when `config.steganography.enabled`, and returns a `T140RtpTransport`. `processAIStreamToStegRtp(stream, address, port, config)` does that and then calls `processAIStreamToRtp`. |

## For AI Agents

### Working In This Directory
- `encodeMode: 'llm'` is rejected on purpose for security. Do not add it back, and do not add any path that evaluates generated code.
- The module needs `@agrathwohl/llm-steg` at runtime. It is not installable without a GitHub token that has the `read:packages` scope, so `tests/steganography.test.ts` skips itself when the package is absent and prints why.
- `StegEngine` is an `EventEmitter` that emits `'error'`. Keep the listener in the constructor.
- `send` must never throw: `T140RtpTransport` calls a custom transport from a drain timer.
- The UDP transport created here attaches its own `'error'` listener so a socket error does not crash the process.

### Testing Requirements
- `tests/steganography.test.ts` covers `StegTransport`, both factory functions, and the encoding path. It mocks `dgram` and skips entirely when `@agrathwohl/llm-steg` is not installed.

### Common Patterns
- Decorator pattern: `StegTransport` wraps any `TransportStream` and is itself a `TransportStream`, so `T140RtpTransport` can use it as `customTransport`.
- Logging uses `debug('t140llm:steg')`.

## Dependencies

### Internal
- `../interfaces`, `../processors/process-ai-stream-to-rtp`, `../rtp/t140-rtp-transport`, `../utils/constants`

### External
- `@agrathwohl/llm-steg` (optional), `debug`, Node `crypto`, `dgram`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
