<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# src

## Purpose
Library source. `index.ts` is the package entry point. It re-exports `interfaces/`, `utils/`, `rtp/`, `processors/`, and `transport/`. `steganography/` is not re-exported.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Barrel. `export *` from `interfaces`, `utils`, `rtp`, `processors`, and `transport`. Nothing else. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `interfaces/` | Shared TypeScript interfaces, types, and enums (see `interfaces/AGENTS.md`) |
| `utils/` | Constants, text extraction, backspace handling, key derivation, shared stream pipeline, demultiplexer (see `utils/AGENTS.md`) |
| `rtp/` | RTP packet builder, `T140RtpTransport`, `T140RtpMultiplexer` (see `rtp/AGENTS.md`) |
| `processors/` | Public `processAIStream*` and `create*Transport` functions, one file per transport (see `processors/AGENTS.md`) |
| `transport/` | WebSocket server that bridges to a SEQPACKET socket (see `transport/AGENTS.md`) |
| `steganography/` | Optional transport wrapper that hides packets in cover media. Not in the prod build (see `steganography/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- Dependency direction: `interfaces` → `utils` → `rtp` → `processors`. `transport` uses `rtp` and `utils`. `steganography` uses `processors`, `rtp`, and `interfaces`. Do not import in the reverse direction.
- When you add a public symbol, export it from the subpackage `index.ts`. The package root re-exports every subpackage.
- Use the constants in `utils/constants.ts`. Do not add new magic numbers.
- Build `T140RtpError` objects with `ErrorFactory` in `utils/error-factory.ts` and emit them as `'error'` events.

### Testing Requirements
- Tests live in `../tests/`, not next to the source. Every suite imports real modules by path; mock only `dgram`, `net`, `ws`, or pass a capturing `customTransport`. Run `npm test`.
- `npm run lint:src` must pass.

### Common Patterns
- Each processor calls `resolveStreamOptions`, then `attachStreamProcessor` with transport-specific callbacks (`sendText`, `sendMetadata`, `close`, `onStreamEnd`).
- An `isAsyncIterable` type guard lets every entry point accept both `EventEmitter` and `AsyncIterable` streams.
- Classes extend `EventEmitter` and list their events in the class JSDoc.

## Dependencies

### Internal
- None outside `src/`.

### External
- `werift-rtp`, `ws`, `debug`. Node built-ins: `dgram`, `net`, `crypto`, `events`, `https`, `fs`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
