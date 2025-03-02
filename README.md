<div align="center" style="text-align: center;">
  <h1 style="border-bottom: none;">t140llm</h1>

  <p>A TypeScript library to convert LLM streaming responses into T.140 real-time text format for WebRTC applications</p>
</div>

<hr />

[![MIT License][mit-license-badge]][mit-license-url]
[![Node version][node-version-badge]][node-version-url]

> Convert LLM streaming responses into T.140 real-time text for WebRTC

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
import { processAIStream } from 't140llm';
import { OpenAI } from 'openai';

// Initialize your LLM client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create a streaming response
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Write a short story.' }],
  stream: true,
});

// Process the stream and convert to T.140
processAIStream(stream);
```

#### With Vercel AI SDK

```typescript
import { processAIStream } from 't140llm';
import { StreamingTextResponse, Message } from 'ai';
import { OpenAI } from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Example API route handler
export async function POST(req: Request) {
  const { messages }: { messages: Message[] } = await req.json();

  // Create a stream with the Vercel AI SDK
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
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
import { processAIStream } from 't140llm';
import Anthropic from '@anthropic-ai/sdk';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Create a streaming response
const stream = await anthropic.messages.create({
  model: 'claude-3-sonnet-20240229',
  messages: [{ role: 'user', content: 'Write a short story.' }],
  stream: true,
});

// Process the stream and convert to T.140
processAIStream(stream);
```

#### Direct RTP Streaming

For direct RTP streaming without needing a WebSocket intermediary:

```typescript
import { processAIStreamToRtp } from 't140llm';
import { OpenAI } from 'openai';

// Initialize your LLM client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create a streaming response
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Write a short story.' }],
  stream: true,
});

// Stream directly to a remote endpoint using RTP
const transport = processAIStreamToRtp(
  stream,
  '192.168.1.100',  // Remote IP address
  5004,             // RTP port (optional, default: 5004)
  {
    payloadType: 96,           // T.140 payload type (optional)
    ssrc: 12345,               // RTP SSRC identifier (optional)
    initialSequenceNumber: 0,  // Starting sequence number (optional)
    initialTimestamp: 0,       // Starting timestamp (optional)
    timestampIncrement: 160    // Timestamp increment per packet (optional)
  }
);

// Later, you can close the transport if needed
// transport.close();
```

#### Secure SRTP Streaming

For secure SRTP streaming:

```typescript
import { processAIStreamToSrtp, createSrtpKeysFromPassphrase } from 't140llm';
import { OpenAI } from 'openai';

// Initialize your LLM client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create a streaming response
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Write a short story.' }],
  stream: true,
});

// Generate SRTP keys from a passphrase
// In a real application, you would exchange these securely with the remote endpoint
const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('your-secure-passphrase');

// Stream directly to a remote endpoint using SRTP
const transport = processAIStreamToSrtp(
  stream,
  '192.168.1.100',  // Remote IP address
  {
    masterKey,      // SRTP master key
    masterSalt,     // SRTP master salt
    payloadType: 96 // T.140 payload type (optional)
  },
  5006              // SRTP port (optional, default: 5006)
);

// Later, you can close the transport if needed
// transport.close();
```

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
4. Your application can receive these packets directly from the UDP socket.

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
- `rtpConfig` <RtpConfig> Optional. Configuration options for RTP.
- returns: <T140RtpTransport> The transport object that can be used to close the connection.

Processes an AI stream and sends the text chunks directly as T.140 data over RTP.

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
- `config` <RtpConfig> Optional. Configuration options for RTP.

#### setupSrtp(srtpConfig)

- `srtpConfig` <SrtpConfig> SRTP configuration including master key and salt.
- returns: <void>

Initializes and configures SRTP for secure transmission.

#### sendText(text)

- `text` <[string][string-mdn-url]> The text to send as T.140.
- returns: <void>

Sends text data as T.140 over RTP or SRTP.

#### close()

- returns: <void>

Closes the UDP socket and cleans up resources.

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

<!-- Badges -->
[node-version-badge]: https://flat.badgen.net/npm/node/t140llm
[mit-license-badge]: https://flat.badgen.net/npm/license/t140llm

