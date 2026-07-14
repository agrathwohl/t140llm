# Examples

Runnable demos live in [`examples/`](https://github.com/agrathwohl/t140llm/tree/master/examples/). Build the library first (`npm run build`), then run any demo with `node examples/<file>`.

## Transport comparison — `demo.js`

Sends the same text stream over WebSocket, RTP, SRTP, and a direct Unix socket, with a timing comparison against raw transmission. Run [`receiver.js`](https://github.com/agrathwohl/t140llm/blob/master/examples/receiver.js) in a second terminal to see the far end.

## Latency benchmark — `latency_benchmark.js`

Measures chunk-to-wire latency through the RTP pipeline for both the EventEmitter and async-iterable stream paths, using an instrumented transport that timestamps every `send()`.

## Forward Error Correction — `fec_demo.js`

Self-contained sender + receiver. Simulates packet loss and shows FEC (RFC 5109) recovering lost packets, with configurable payload type and group size and recovery-rate statistics.

## Multiplexing — `multiplexed_streams_example.js`

Combines several LLM streams into one RTP output, tagging each with a CSRC stream ID. Pair it with [`demultiplexer_example.js`](https://github.com/agrathwohl/t140llm/blob/master/examples/demultiplexer_example.js) to split them back apart on the far end.

## Baudot / TTY telegraph — `baudot_ita2_tty_example.js`

Transcodes T.140 text to 5-bit Baudot/ITA2, the encoding used by TTY telegraph machines and analog TTY relay lines — `t140llm` sitting between an LLM stream and a real telegraph.

## Backspace handling — `backspace_example.js`

Processes T.140 backspace characters (`processBackspaces: true`), simulating live typing with corrections and comparing output with and without backspace handling.

## Custom transport — `custom_transport_example.js`

A transport that logs packets instead of sending them, used both directly with [`T140RtpTransport`](/api#t140rtptransport) and via `processAIStreamToRtp` — a template for real transports like WebRTC data channels.

## Direct socket — `direct_socket_example.js`

Sends RTP-framed T.140 straight to a SEQPACKET socket. Set up a listener first:

```sh
socat -u UNIX-LISTEN:/tmp/seqpacket_socket,type=seqpacket STDIO
node examples/direct_socket_example.js
```

## Steganography — `steganography/`

Hides RTP packets inside cover media, including LLM-generated steganography algorithms and custom steganographic transports. See [`steganography/README.md`](https://github.com/agrathwohl/t140llm/blob/master/examples/steganography/README.md).

## Default ports

| Transport | Port |
| --- | --- |
| WebSocket | 8765 |
| RTP | 5004 |
| SRTP | 5006 |
| Direct (comparison) | 5008 |
