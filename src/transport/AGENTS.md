<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-11-02 | Updated: 2026-11-02 -->

# transport

## Purpose
The server side of the WebSocket transport. It accepts WebSocket clients and forwards each message as an RTP packet to the local Unix socket.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Barrel for `websocket-server.ts`. |
| `websocket-server.ts` | `createWebSocketServer({ port?, host?, tls? })` returns a `ws` `WebSocket.Server`. It listens on `127.0.0.1` unless `host` is given, because the relay has no authentication, and accepts messages up to 64 KiB. With `tls`, it reads PEM `cert`, `key`, and optional `ca` from file paths and throws if any file is not PEM. Each connection is one RTP stream: its own SSRC, sequence counter, and 1000 Hz clock. It opens `net.createConnection(SEQPACKET_SOCKET_PATH)`, wraps each message with `createRtpPacket`, queues up to 1000 packets until the socket connects, closes the client with code 1011 when the backend socket errors or 1013 when the queue is full, and logs client socket errors instead of crashing. Logs through `debug('t140llm:websocket')`. |

## For AI Agents

### Working In This Directory
- The server is not started automatically. Consumers call `createWebSocketServer()` themselves.
- Keep the fail-closed TLS behaviour. Do not add a fallback to plain `ws://` when certificate files are invalid.
- The relay forwards every message as T.140 text, including the JSON metadata frames that `attachStreamToWebSocket` sends when `sendMetadataOverWebsocket` is on.
- `net.createConnection` opens a stream socket, not a SEQPACKET socket, so packet boundaries are not preserved on the Unix socket.

### Testing Requirements
- No dedicated test. Check a server change by hand with `examples/receiver.js`.

### Common Patterns
- Logging uses `debug`, not `console`.

## Dependencies

### Internal
- `../rtp/create-rtp-packet`, `../rtp/t140-clock`, `../utils/constants`, `../utils/security`

### External
- `ws`, `debug`, Node `fs`, `https`, `net`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
