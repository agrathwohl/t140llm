<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# steganography

## Purpose
Demos for the optional steganography transport in `../../src/steganography/`.

## Key Files
| File | Description |
|------|-------------|
| `README.md` | Overview, run steps, capacity notes, and an API sketch. Parts of it are out of date (see below). |
| `llm_steg_example.js` | Encodes and decodes RTP packets in generated cover media, then runs an AI stream through `processAIStreamToStegRtp`. |
| `custom_steg_transport_example.js` | A custom steganography transport with packet tracking, bit-change statistics, and `T140RtpTransport` integration. |

## For AI Agents

### Working In This Directory
- `README.md` says the module is powered by `llm-steg` and that `require('t140llm')` exports `StegTransport`. In this tree there is no `llm-steg` dependency, the root barrel does not export steganography, and `npm run build` does not compile `src/steganography/`. Check the import path in each example before you rely on it.
- Keep `encodeMode: 'fixed'`. The `'llm'` mode throws in `StegTransport`.

### Testing Requirements
- Run `node examples/steganography/<file>` after `npm run build`. No automated check.

## Dependencies

### Internal
- `../../src/steganography/`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
