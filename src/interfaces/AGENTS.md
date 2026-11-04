<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# interfaces

## Purpose
TypeScript interfaces, type aliases, and enums shared by every other module. This directory has no runtime logic except the `T140RtpErrorType` enum.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Barrel that re-exports all six interface files. |
| `rtp-config.interface.ts` | `RtpConfig`: payload type, SSRC, initial sequence/timestamp, `timestampIncrement`, FEC (`fecEnabled`, `fecPayloadType`, `fecGroupSize`), RED (`redEnabled`, `redPayloadType`, `redundancyLevel`), `processBackspaces`, `charRateLimit`, `customTransport`, metadata options (`handleMetadata`, `metadataCallback`, `sendMetadataAsPackets`, `metadataPayloadType`), `onError`, multiplex options (`multiplexEnabled`, `streamIdentifier`, `csrcList`, `useCsrcForStreamId`), `markerBit`, `bomPrewarm`. |
| `srtp-config.interface.ts` | `SrtpProtectionProfile` (`0x0001` or `0x0007`, the profiles werift-rtp implements) and `SrtpConfig extends Omit<RtpConfig, 'charRateLimit'>` with `masterKey`, `masterSalt`, `profile?`, `isSRTCP?`. |
| `t140-rtp-error.interface.ts` | `T140RtpErrorType` enum (`NETWORK_ERROR`, `ENCRYPTION_ERROR`, `FEC_ERROR`, `INVALID_CONFIG`, `RATE_LIMIT_ERROR`, `RESOURCE_ERROR`) and `T140RtpError { type, message, cause? }`. |
| `text-data-stream.interface.ts` | `LLMMetadata { type, content, id? }`, `TextDataStream = EventEmitter \| AsyncIterable<unknown>`, `ProcessorOptions` (`processBackspaces`, `handleMetadata`, `metadataCallback`, `sendMetadataOverTransport`, `onError`). |
| `transport-stream.interface.ts` | `TransportStream { send(data, callback?), close?() }`. The contract for custom transports. |
| `websocket-options.interface.ts` | `TLSOptions`, `WebSocketOptions`, `AttachStreamOptions extends ProcessorOptions` (adds `sendMetadataOverWebsocket`, `tlsOptions`). |

## For AI Agents

### Working In This Directory
- One interface group per file, file name ends in `.interface.ts`. Add new files to `index.ts`.
- Every `RtpConfig` field is optional. Keep it that way; processors fill defaults from `../utils/constants.ts`.
- `SrtpConfig` omits `charRateLimit` on purpose. Do not add it back.
- When you add a field to `RtpConfig`, update `../../docs/types.md`.

### Testing Requirements
- No direct tests. Type changes surface through `npm run ts` and the suites in `../../tests/`.

### Common Patterns
- Inline `//` comments after each field describe its meaning and default.
- Errors are plain objects, not `Error` subclasses. Build them with `ErrorFactory` in `../utils/error-factory.ts`.

## Dependencies

### Internal
- `transport-stream.interface.ts` and `text-data-stream.interface.ts` are imported by `rtp-config.interface.ts`.

### External
- Node `events` (for the `EventEmitter` type)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
