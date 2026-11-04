<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# utils

## Purpose
Shared helpers that do not own a transport: protocol constants, text extraction from LLM chunks, T.140 backspace handling, SRTP key derivation, the stream processing pipeline that every processor uses, and the receive-side demultiplexer.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Barrel. Exports every file here except `error-factory.ts`. |
| `constants.ts` | Protocol constants grouped by RFC with a source link per group: RTP header sizes and limits (RFC 3550), ports and dynamic payload types (96 text/t140, 97 FEC, 98 RED, 99 metadata), `T140_CLOCK_RATE` 1000, `DEFAULT_CHAR_RATE_LIMIT` 30, `SEND_INTERVAL_MS` 100, `IDLE_THRESHOLD_MS` 300, `BACKSPACE`, RED limits (`RED_MAX_BLOCK_LENGTH` 1023, `RED_MAX_TIMESTAMP_OFFSET` 16383), FEC sizes (`FEC_HEADER_SIZE` 10, `FEC_LEVEL_HEADER_SIZE` 4, `FEC_MAX_GROUP_SIZE` 16), token bucket constants, multiplex conventions (`MULTIPLEX_STREAM_DELIMITER` `\x1E`, `METADATA_PACKET_PREFIX` `MD:`, `MAX_METADATA_PAYLOAD_SIZE` 1200), SRTP key sizes and `PBKDF2_ITERATIONS` 600000. |
| `stream-processor.ts` | `resolveStreamOptions(processorOptions, configOptions)` merges defaults, including `onError`. `attachStreamProcessor(stream, options, callbacks)` drives both `EventEmitter` and `AsyncIterable` streams through one `handleChunk`: extracts text and metadata, applies backspaces, calls `sendText`/`sendMetadata`, then `onStreamEnd` and `close`, and swallows exceptions thrown by `metadataCallback`. Returns a `detach()` function that removes only its own listeners or stops consuming the iterable. The backspace buffer keeps a 256-character tail. `isAsyncIterable` is exported. |
| `extract-text.ts` | `extractTextFromChunk(chunk, extractMetadata)` returns `{ text, metadata? }`. Text comes from the first string field found among the OpenAI, Anthropic, Mistral, Cohere, Ollama, and Gemini shapes, from a string, or from a Buffer. Plain objects with no text field yield `''`, so SDK event objects are not transmitted as `[object Object]`. `detectMetadata` finds tool calls, tool results, reasoning, and `metadata` fields; later matches win. |
| `backspace-processing.ts` | `toGraphemes(str)` splits on grapheme clusters with `Intl.Segmenter`. `processT140BackspaceChars(text, buffer)` applies `BACKSPACE` per grapheme and returns `{ processedText, updatedBuffer, processedGraphemes }`. |
| `security.ts` | `generateSecureSSRC()` from `crypto.randomBytes`. `createSrtpKeysFromPassphrase(passphrase, salt?)` runs PBKDF2-SHA256 and returns `{ masterKey (16 bytes), masterSalt (14 bytes), salt }`. Throws when the salt is shorter than 16 bytes. |
| `parse-red-packet.ts` | `parseT140RedPacket(packet)` decodes a text/red packet per RFC 2198 §3 into `{ payloadType, sequenceNumber, timestamp, ssrc, marker, redundant, primary }`, with 14-bit timestamp offsets and 10-bit lengths, and throws on truncation. `extractT140Text(packet, redPayloadType = 98)` returns the text a receiver should display for either text/red or plain text/t140, skipping the CSRC list, header extension, and padding. |
| `demultiplex-streams.ts` | `T140StreamDemultiplexer.processPacket(buffer, useCSRC)` reads the text with `extractT140Text`, so it handles text/red as well as plain text/t140, then splits multiplexed RTP into per-stream `DemultiplexedStreamImpl` emitters. The constructor takes `{ redPayloadType }` (default 98). An empty primary T140block creates the stream but raises no data event, because it marks an idle period (RFC 4103 §5.2). Emits `'stream'` for a new stream; each stream emits `'data'`, `'metadata'`, `'end'`, `'error'`. `getStream(id)`, `getStreamIds()`. It does not parse RED or FEC packets. |
| `error-factory.ts` | `ErrorFactory` static methods (`NETWORK`, `ENCRYPTION`, `FEC`, `INVALID_CONFIG`, `RATE_LIMIT`, `RESOURCE`) that build `T140RtpError` objects. Internal; not in the barrel. |

## For AI Agents

### Working In This Directory
- Put every new literal number or protocol string in `constants.ts` with a comment that names the RFC section.
- `attachStreamProcessor` is the single place that handles stream lifecycle. Change it there, not in a processor or in the multiplexer.
- `toGraphemes` needs `Intl.Segmenter`, which Node 16+ provides. Do not replace it with `Array.from(str)`.
- The random salt from `createSrtpKeysFromPassphrase` must travel with the keys. Callers that need to reproduce keys pass the same salt back in.

### Testing Requirements
- `tests/backspace-processing.test.ts`, `tests/reasoning-stream.test.ts`, `tests/async-iterator.test.ts`, `tests/multiplexing-e2e.test.ts`, and `tests/rfc4103-wire-format.test.ts` cover this directory. The RED parser is checked bit by bit in `tests/rfc4103-wire-format.test.ts`. Run them after any change here.

### Common Patterns
- Functions are pure where possible and return result objects instead of mutating inputs.
- Receive-side code parses the RTP header with the sizes from `constants.ts`.

## Dependencies

### Internal
- `../interfaces`

### External
- Node `crypto`, `events`, `Intl.Segmenter`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
