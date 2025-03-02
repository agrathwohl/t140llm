<div align="center" style="text-align: center;">
  
  ![T140LLM](logo.gif)

  <h1 style="border-bottom: none;">t140llm</h1>

  <p>A TypeScript library to convert LLM streaming responses into T.140 real-time text format for SIP, WebRTC and (S)RTP applications</p>
</div>

<hr />

> Convert LLM streaming responses into T.140 real-time text

## Table of contents <!-- omit in toc -->

- [Pre-requisites](#pre-requisites)
- [Setup](#setup)
  - [Install](#install)
  - [Usage](#usage)
    - [Basic Usage](#basic-usage)
    - [With Vercel AI SDK](#with-vercel-ai-sdk)
    - [With Anthropic Claude](#with-anthropic-claude)
    - [Direct RTP Streaming](#direct-rtp-streaming)
    - [Secure SRTP Streaming](#secure-srtp-streaming)
    - [With Forward Error Correction](#with-forward-error-correction)
- [How It Works](#how-it-works)
- [API Reference](#api-reference)
  - [processAIStream(stream, [websocketUrl])](#processaistreamstream-websocketurl)
  - [processAIStreamToRtp(stream, remoteAddress, [remotePort], [rtpConfig])](#processaistreamtortpstream-remoteaddress-remoteport-rtpconfig)
  - [processAIStreamToSrtp(stream, remoteAddress, srtpConfig, [remotePort])](#processaistreamtosrtpstream-remoteaddress-srtpconfig-remoteport)
  - [createRtpPacket(sequenceNumber, timestamp, payload, [options])](#creatertppacketsequencenumber-timestamp-payload-options)
  - [createSrtpKeysFromPassphrase(passphrase)](#createsrtpkeysfrompassphrasepassphrase)
  - [T140RtpTransport](#t140rtptransport)
- [License](#license)

## Pre-requisites

- [Node.js][nodejs-url] >= 10.18.1
- [NPM][npm-url] >= 6.13.4 ([NPM][npm-url] comes with [Node.js][nodejs-url] so there is no need to install separately.)

## Setup

### Install

```sh
# Install via NPM
$ npm install --save t140llm
```

### Usage

#### Basic Usage

```typescript
import { processAIStream } from "t140llm";
import { OpenAI } from "openai";

// Initialize your LLM client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create a streaming response
const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

// Process the stream and convert to T.140
processAIStream(stream);
```

#### With Vercel AI SDK

```typescript
import { processAIStream } from "t140llm";
import { StreamingTextResponse, Message } from "ai";
import { OpenAI } from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Example API route handler
export async function POST(req: Request) {
  const { messages }: { messages: Message[] } = await req.json();

  // Create a stream with the Vercel AI SDK
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages,
    stream: true,
  });

  // Process the stream with t140llm
  processAIStream(response);

  // You can still return the response to the client
  return new StreamingTextResponse(response);
}
```

#### With Anthropic Claude

```typescript
import { processAIStream } from "t140llm";
import Anthropic from "@anthropic-ai/sdk";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Create a streaming response
const stream = await anthropic.messages.create({
  model: "claude-3-sonnet-20240229",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

// Process the stream and convert to T.140
processAIStream(stream);
```

#### Direct RTP Streaming

For direct RTP streaming without needing a WebSocket intermediary:

```typescript
import { processAIStreamToRtp } from "t140llm";
import { OpenAI } from "openai";

// Initialize your LLM client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create a streaming response
const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

// Stream directly to a remote endpoint using RTP
const transport = processAIStreamToRtp(
  stream,
  "192.168.1.100", // Remote IP address
  5004, // RTP port (optional, default: 5004)
  {
    payloadType: 96, // T.140 payload type (optional)
    ssrc: 12345, // RTP SSRC identifier (optional)
    initialSequenceNumber: 0, // Starting sequence number (optional)
    initialTimestamp: 0, // Starting timestamp (optional)
    timestampIncrement: 160, // Timestamp increment per packet (optional)
  },
);

// Later, you can close the transport if needed
// transport.close();
```

#### Secure SRTP Streaming

For secure SRTP streaming:

```typescript
import { processAIStreamToSrtp, createSrtpKeysFromPassphrase } from "t140llm";
import { OpenAI } from "openai";

// Initialize your LLM client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create a streaming response
const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

// Generate SRTP keys from a passphrase
// In a real application, you would exchange these securely with the remote endpoint
const { masterKey, masterSalt } = createSrtpKeysFromPassphrase(
  "your-secure-passphrase",
);

// Stream directly to a remote endpoint using SRTP
const transport = processAIStreamToSrtp(
  stream,
  "192.168.1.100", // Remote IP address
  {
    masterKey, // SRTP master key
    masterSalt, // SRTP master salt
    payloadType: 96, // T.140 payload type (optional)
  },
  5006, // SRTP port (optional, default: 5006)
);

// Later, you can close the transport if needed
// transport.close();
```

#### With Forward Error Correction

For RTP streaming with Forward Error Correction (FEC) according to RFC 5109:

```typescript
import { processAIStreamToRtp } from "t140llm";
import { OpenAI } from "openai";

// Initialize your LLM client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create a streaming response
const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

// Stream directly to a remote endpoint using RTP with FEC enabled
const transport = processAIStreamToRtp(
  stream,
  "192.168.1.100", // Remote IP address
  5004, // RTP port (optional, default: 5004)
  {
    payloadType: 96, // T.140 payload type
    ssrc: 12345, // RTP SSRC identifier
    // FEC configuration
    fecEnabled: true, // Enable Forward Error Correction
    fecPayloadType: 97, // Payload type for FEC packets
    fecGroupSize: 5, // Number of media packets to protect with one FEC packet
  },
);

// Later, you can close the transport if needed
// transport.close();
```

## Why?

The T.140 protocol is a well-defined standard for transmitting text conversations
over IP networks in real-time, making it an effective way to transmit text as
it is being written to satelites, noisy environments, and environments where
low latency transmission is a requirement. Unlike other approaches, the T.140
standard enables transmission of text before the entire message has been both
composed and sent.

Because LLMs do not make mistakes while "typing," there is no true downside to
using such an approach for transmitting the data they output. That said, we _did_
provide support for backspace characters, should you require this! Using T.140,
you can both reduce the overall file size of packets being delivered, and improve
your quality of experience when latency is a particularly sensitive measurement.

## How It Works

### WebSocket Mode

1. The library sets up a WebSocket server to receive text chunks.
2. When an LLM stream is processed, each text chunk is sent through the WebSocket.
3. The WebSocket server encapsulates the text in T.140 format using RTP packets.
4. The RTP packets are sent through a Unix SEQPACKET socket.
5. Your application can read from this socket to get the real-time text data.

### Direct RTP Mode

1. The library creates a UDP socket to send RTP packets.
2. When an LLM stream is processed, each text chunk is packaged as T.140 in an RTP packet.
3. The RTP packets are sent directly to the specified IP address and port.
4. If Forward Error Correction (FEC) is enabled, the library will:
   - Store packets in a buffer
   - Generate FEC packets using XOR-based operations following RFC 5109
   - Send FEC packets at configured intervals (based on group size)
5. Your application can receive these packets directly from the UDP socket, using FEC packets to recover from packet loss.

### Secure SRTP Mode

1. The library creates a UDP socket and initializes an SRTP session with the provided keys.
2. When an LLM stream is processed, each text chunk is packaged as T.140 in an RTP packet.
3. The RTP packets are encrypted using SRTP with the configured encryption parameters.
4. The encrypted SRTP packets are sent to the specified IP address and port.
5. Your application can decrypt and receive these packets using the same SRTP parameters.

## API Reference

### processAIStream(stream, [websocketUrl])

- `stream` <TextDataStream> The streaming data source that emits text chunks.
- `websocketUrl` <[string][string-mdn-url]> Optional. WebSocket URL to connect to. Defaults to `ws://localhost:8765`.
- returns: <void>

Processes an AI stream and sends the text chunks as T.140 data through a WebSocket.

### processAIStreamToRtp(stream, remoteAddress, [remotePort], [rtpConfig])

- `stream` <TextDataStream> The streaming data source that emits text chunks.
- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send RTP packets to.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send RTP packets to. Defaults to `5004`.
- `rtpConfig` <RtpConfig> Optional. Configuration options for RTP:
  - `payloadType` <[number][number-mdn-url]> Optional. The RTP payload type. Defaults to `96`.
  - `ssrc` <[number][number-mdn-url]> Optional. The RTP synchronization source. Defaults to `12345`.
  - `initialSequenceNumber` <[number][number-mdn-url]> Optional. The initial sequence number. Defaults to `0`.
  - `initialTimestamp` <[number][number-mdn-url]> Optional. The initial timestamp. Defaults to `0`.
  - `timestampIncrement` <[number][number-mdn-url]> Optional. The timestamp increment per packet. Defaults to `160`.
  - `fecEnabled` <[boolean][boolean-mdn-url]> Optional. Enable Forward Error Correction. Defaults to `false`.
  - `fecPayloadType` <[number][number-mdn-url]> Optional. The payload type for FEC packets. Defaults to `97`.
  - `fecGroupSize` <[number][number-mdn-url]> Optional. Number of media packets to protect with one FEC packet. Defaults to `5`.
- returns: <T140RtpTransport> The transport object that can be used to close the connection.

Processes an AI stream and sends the text chunks directly as T.140 data over RTP. When FEC is enabled, it adds Forward Error Correction packets according to RFC 5109 to help recover from packet loss.

### processAIStreamToSrtp(stream, remoteAddress, srtpConfig, [remotePort])

- `stream` <TextDataStream> The streaming data source that emits text chunks.
- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send SRTP packets to.
- `srtpConfig` <SrtpConfig> SRTP configuration including master key and salt.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send SRTP packets to. Defaults to `5006`.
- returns: <T140RtpTransport> The transport object that can be used to close the connection.

Processes an AI stream and sends the text chunks directly as T.140 data over secure SRTP.

### createRtpPacket(sequenceNumber, timestamp, payload, [options])

- `sequenceNumber` <[number][number-mdn-url]> RTP sequence number.
- `timestamp` <[number][number-mdn-url]> RTP timestamp.
- `payload` <[string][string-mdn-url]> Text payload to encapsulate.
- `options` <Partial<RtpConfig>> Optional. Configuration options for the RTP packet.
- returns: <Buffer> RTP packet with T.140 payload.

Creates an RTP packet with a T.140 payload.

### createSrtpKeysFromPassphrase(passphrase)

- `passphrase` <[string][string-mdn-url]> A passphrase to derive SRTP keys from.
- returns: <Object> An object containing the `masterKey` and `masterSalt` for SRTP.

Creates SRTP master key and salt from a passphrase. For production, use a more secure key derivation function.

### T140RtpTransport

A class that manages RTP/SRTP connections for sending T.140 data.

#### constructor(remoteAddress, [remotePort], [config])

- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send packets to.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send packets to. Defaults to `5004`.
- `config` <RtpConfig> Optional. Configuration options for RTP, including FEC options.

#### setupSrtp(srtpConfig)

- `srtpConfig` <SrtpConfig> SRTP configuration including master key and salt.
- returns: <void>

Initializes and configures SRTP for secure transmission.

#### sendText(text)

- `text` <[string][string-mdn-url]> The text to send as T.140.
- returns: <void>

Sends text data as T.140 over RTP or SRTP. If FEC is enabled, it will also generate and send FEC packets according to the configured group size.

#### close()

- returns: <void>

Closes the UDP socket and cleans up resources. If FEC is enabled, it will send any remaining FEC packets before closing.

## License

[MIT License](https://mit-license.org/) © agrathwohl

<!-- References -->

[typescript-url]: https://github.com/Microsoft/TypeScript
[nodejs-url]: https://nodejs.org
[npm-url]: https://www.npmjs.com
[node-version-url]: https://nodejs.org/en/download
[mit-license-url]: https://github.com/agrathwohl/t140llm/blob/master/LICENSE

<!-- MDN -->

[string-mdn-url]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String
[number-mdn-url]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number
[promise-mdn-url]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise
[boolean-mdn-url]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean

<!-- Badges -->

[node-version-badge]: https://flat.badgen.net/npm/node/t140llm
[mit-license-badge]: https://flat.badgen.net/npm/license/t140llm
