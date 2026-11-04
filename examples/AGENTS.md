<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# examples

## Purpose
Runnable Node.js scripts that show each transport and feature. They `require` the built package, so run `npm run build` first. See `README.md` here for the run steps.

## Key Files
| File | Description |
|------|-------------|
| `README.md` | How to run each demo, default ports, `socat` command for the SEQPACKET listener. |
| `demo.js` | Same text stream over WebSocket, RTP, SRTP, and a direct socket, with timing. |
| `receiver.js` | Far end for `demo.js`: listens on UDP ports and the WebSocket server. Decodes text/red with `extractT140Text` and reports the redundant blocks. |
| `dtls_srtp_example.js` | SRTP with keys from a DTLS-SRTP handshake (RFC 5764). Self-contained: runs both roles over loopback. |
| `fec_demo.js` | Forward Error Correction (RFC 5109) with simulated packet loss and recovery stats. |
| `direct_socket_example.js` | UDP RTP to a SEQPACKET socket through a bridge. |
| `seqpacket.js` | UDP-to-SEQPACKET bridge using `node-unix-socket`. |
| `backspace_example.js` | T.140 backspace handling with `processBackspaces`. |
| `custom_transport_example.js` | A logging `TransportStream` used with `T140RtpTransport` and `processAIStreamToRtp`. |
| `multiplexed_streams_example.js` | Several mock LLM streams multiplexed into one RTP output. |
| `demultiplexer_example.js` | Receives multiplexed RTP on UDP and splits it with `T140StreamDemultiplexer`. |
| `latency_benchmark.js` | Chunk-to-wire latency for `EventEmitter` and async-iterable inputs. |
| `baudot_ita2_tty_example.js` | Transcodes T.140 text to 5-bit Baudot/ITA2 for a TTY line. |
| `pre_connect_example.js` | Creates a transport before the LLM stream exists. |
| `metadata_example.js` | Tool-call metadata over WebSocket. |
| `metadata_direct_socket_example.js` | Tool-call metadata in direct socket mode. |
| `reasoning_example.js` | Reasoning streams over WebSocket. |
| `reasoning_direct_socket_example.js` | Reasoning streams in direct socket mode. |
| `gemini_example.js` | Google Gemini SDK stream. |
| `ollama_mistral_cohere_example.js` | Ollama, Mistral, and Cohere streams. |

Untracked files in this directory: `anthropic.mjs` (git-ignored by `*.mjs`), `.env` (git-ignored, holds `ANTHROPIC_API_KEY`), and `socket` (a Unix socket file left by a run). Do not commit or print the `.env` contents.

Verified working by running them: `custom_transport_example.js`, `backspace_example.js`, `latency_benchmark.js`, `pre_connect_example.js`, `fec_demo.js`, `dtls_srtp_example.js`, `multiplexed_streams_example.js` with `demultiplexer_example.js`, and both steganography examples.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `steganography/` | Steganography transport demos (see `steganography/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- Examples are plain CommonJS JavaScript, not TypeScript. They are not linted or tested. Check them with `node --check`, and run the self-contained ones.
- Redundancy is on by default, so a receiver cannot read the text at byte offset 12. Use `extractT140Text` or `parseT140RedPacket`, or pass `redEnabled: false`.
- FEC is the alternative to redundancy, not an addition: examples that demonstrate FEC pass `redEnabled: false`.
- `customTransport` takes a `TransportStream` with a `send` method. To reuse a `T140RtpTransport`, pass it as the fifth argument of `processAIStreamTo*` instead.
- The two steganography examples need the optional `@agrathwohl/llm-steg` package.
- Default ports: WebSocket 8765, RTP 5004, SRTP 5006. The SEQPACKET path is `/tmp/seqpacket_socket`.
- Direct socket demos need a listener first: `socat -u UNIX-LISTEN:/tmp/seqpacket_socket,type=seqpacket STDIO` or `node examples/seqpacket.js`.
- `../README.md` and `../docs/examples.md` link to specific files here by name. Update those links when you rename a file.

### Testing Requirements
- Run the script with `node examples/<file>` after `npm run build`. There is no automated check.

### Common Patterns
- A mock stream is an `EventEmitter` that emits `'data'` on an interval and then `'end'`.
- Only `direct_socket_example.js` and the untracked `anthropic.mjs` load `.env` through `dotenv`.

## Dependencies

### Internal
- `../dist/` (the built package)

### External
- `node-unix-socket`, `dotenv`, `@anthropic-ai/sdk`, provider SDKs installed by the user

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
