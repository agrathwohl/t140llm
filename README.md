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
    - [With Custom Transport](#with-custom-transport)
    - [Pre-connecting to Transport](#pre-connecting-to-transport)
    - [Multiplexing Multiple LLM Streams](#multiplexing-multiple-llm-streams)
- [How It Works](#how-it-works)
- [API Reference](#api-reference)
  - [processAIStream(stream, [websocketUrl])](#processaistreamstream-websocketurl)
  - [processAIStreamToRtp(stream, remoteAddress, [remotePort], [rtpConfig])](#processaistreamtortpstream-remoteaddress-remoteport-rtpconfig)
  - [processAIStreamToSrtp(stream, remoteAddress, srtpConfig, [remotePort])](#processaistreamtosrtpstream-remoteaddress-srtpconfig-remoteport)
  - [processAIStreamToDirectSocket(stream, [socketPath], [rtpConfig])](#processaistreamtodirectsocketstream-socketpath-rtpconfig)
  - [processAIStreamsToMultiplexedRtp(streams, remoteAddress, [remotePort], [rtpConfig])](#processaistreamstomultiplexedrtpstreams-remoteaddress-remoteport-rtpconfig)
  - [createT140WebSocketConnection(websocketUrl, [options])](#createt140websocketconnectionwebsocketurl-options)
  - [createDirectSocketTransport(socketPath, [rtpConfig])](#createdirectsockettransportsocketpath-rtpconfig)
  - [createT140RtpTransport(remoteAddress, [remotePort], [rtpConfig])](#createt140rtptransportremoteaddress-remoteport-rtpconfig)
  - [createT140SrtpTransport(remoteAddress, srtpConfig, [remotePort])](#createt140srtptransportremoteaddress-srtpconfig-remoteport)
  - [createT140RtpMultiplexer(remoteAddress, [remotePort], [multiplexConfig])](#createt140rtpmultiplexerremoteaddress-remoteport-multiplexconfig)
  - [createRtpPacket(sequenceNumber, timestamp, payload, [options])](#creatertppacketsequencenumber-timestamp-payload-options)
  - [createSrtpKeysFromPassphrase(passphrase)](#createsrtpkeysfrompassphrasepassphrase)
  - [T140RtpTransport](#t140rtptransport)
  - [T140RtpMultiplexer](#t140rtpmultiplexer)
  - [T140StreamDemultiplexer](#t140streamdemultiplexer)
  - [TransportStream Interface](#transportstream-interface)
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

### Features

- [x] T.140 RTP Payload Formatting
- [x] T.140 redundancy
- [x] T.140 FEC (forward error correction)
- [x] (S)RTP Direct Delivery
- [x] Customizable Rate Limiting and Token Pooling
- [x] Custom Transport Streams (WebRTC, custom protocols, etc.)
- [x] UNIX SEQPACKET sockets (for supporting >1 LLM stream simultaneously)
- [x] UNIX STREAM sockets (for single LLM stream support)
- [x] WebSocket
- [x] Stream Multiplexing (combine multiple LLM streams into a single RTP output)

### Support

- [x] Vercel AI SDK
- [x] Anthropic SDK
- [x] OpenAI SDK
- [x] Cohere
- [x] Mistral
- [ ] Amazon (Bedrock)
- [ ] Google (Gemini/PaLM)
- [x] Ollama
- [x] Reasoning Support
- [ ] Binary Data
- [x] Tools
- [x] LLM Output Metadata
- [ ] PDFs/Documents
- [ ] Images
- [ ] Video
- [ ] Signaling
- [ ] Custom RTP Packet Data

### Usage

Ever wanted to send an LLM text stream to a [telegraph machine][tm]? Or send Claude
to an [assistive reader device][ad]? Or pipe some o1 reasoning directly to a [satelite
orbiting the planet][sat] with forward error correction to ensure the message
arrives in full? If so, read on...

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

#### With Mistral AI

```typescript
import { processAIStream } from "t140llm";
import MistralClient from "@mistralai/mistralai";

// Initialize Mistral client
const mistral = new MistralClient({
  apiKey: process.env.MISTRAL_API_KEY,
});

// Create a streaming response
const stream = await mistral.chat({
  model: "mistral-large-latest",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

// Process the stream and convert to T.140
processAIStream(stream);
```

#### With Cohere

```typescript
import { processAIStream } from "t140llm";
import { CohereClient } from "cohere-ai";

// Initialize Cohere client
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

// Create a streaming response
const stream = await cohere.chatStream({
  model: "command",
  message: "Write a short story.",
});

// Process the stream and convert to T.140
processAIStream(stream);
```

#### With Ollama

```typescript
import { processAIStream } from "t140llm";
import { Ollama } from "ollama";

// Initialize Ollama client
const ollama = new Ollama();

// Create a streaming response
const stream = await ollama.chat({
  model: "llama3",
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

#### With Custom Transport

You can use your own transport mechanism instead of the built-in UDP socket:

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

// Create a custom transport (e.g., WebRTC data channel, custom socket, etc.)
class MyCustomTransport {
  send(data, callback) {
    // Send the data using your custom transport mechanism
    console.log(`Sending ${data.length} bytes`);
    // ...your sending logic here...

    // Call the callback when done (or with an error if it failed)
    if (callback) callback();
  }

  close() {
    // Clean up resources when done
    console.log("Transport closed");
  }
}

// Stream using the custom transport
const customTransport = new MyCustomTransport();
const transport = processAIStreamToRtp(
  stream,
  "dummy-address", // Not used with custom transport
  5004, // Not used with custom transport
  {
    customTransport, // Your custom transport implementation
    payloadType: 96,
    redEnabled: true, // You can still use features like redundancy with custom transport
  },
);

// The transport will be closed automatically when the stream ends
```

#### Pre-connecting to Transport

You can establish the transport connection before the LLM stream is available, which can reduce latency when the stream starts:

```typescript
import { createT140WebSocketConnection } from "t140llm";

// Create the WebSocket connection early, before the LLM stream is available
const { connection, attachStream } = createT140WebSocketConnection(
  "ws://localhost:5004",
);

// Later, when the LLM stream becomes available, attach it to the existing connection
function handleLLMResponse(llmStream) {
  // Attach the stream to the pre-created connection
  attachStream(llmStream, {
    processBackspaces: true,
    handleMetadata: true,
  });
}

// Similar pre-connection functions are available for all transport types:
// - createDirectSocketTransport()
// - createT140RtpTransport()
// - createT140SrtpTransport()
```

This is especially useful in scenarios where:

1. You want to establish the connection in advance to minimize latency
2. You need to reuse the same transport for multiple LLM streams
3. Your architecture needs to separate transport creation from stream processing

See the [examples/pre_connect_example.js](examples/pre_connect_example.js) file for complete examples of pre-connecting with different transport types.

#### Multiplexing Multiple LLM Streams

You can combine multiple LLM streams into a single RTP output stream using the multiplexer:

```typescript
import { processAIStreamsToMultiplexedRtp, createT140RtpMultiplexer, addAIStreamToMultiplexer } from "t140llm";
import { OpenAI } from "openai";
import Anthropic from "@anthropic-ai/sdk";

// Initialize clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Create streaming responses from different models
const stream1 = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a short story about robots." }],
  stream: true,
});

const stream2 = await anthropic.messages.create({
  model: "claude-3-sonnet-20240229",
  messages: [{ role: "user", content: "Write a short poem about nature." }],
  stream: true,
});

// Method 1: Use the convenience function to multiplex streams
const streams = new Map();
streams.set('gpt4', stream1);
streams.set('claude', stream2);

const multiplexer = processAIStreamsToMultiplexedRtp(
  streams,
  "192.168.1.100", // Remote IP address
  5004, // RTP port
  {
    multiplexEnabled: true, // Required for multiplexing
    useCsrcForStreamId: true, // Use CSRC field for stream identification (recommended)
    charRateLimit: 60, // Higher rate limit for multiple streams
  }
);

// Method 2: Create multiplexer first, then add streams dynamically
const multiplexer = createT140RtpMultiplexer(
  "192.168.1.100", // Remote IP address
  5004, // RTP port
  {
    multiplexEnabled: true,
    useCsrcForStreamId: true,
  }
);

// Add streams with unique identifiers
multiplexer.addStream('gpt4', stream1);
multiplexer.addStream('claude', stream2);

// Add another stream later when it becomes available
const stream3 = await openai.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{ role: "user", content: "Write a joke." }],
  stream: true,
});

addAIStreamToMultiplexer(multiplexer, 'gpt35', stream3);

// Listen for multiplexer events
multiplexer.on('streamAdded', (id) => {
  console.log(`Stream added: ${id}`);
});

multiplexer.on('streamRemoved', (id) => {
  console.log(`Stream removed: ${id}`);
});

multiplexer.on('streamError', ({ streamId, error }) => {
  console.error(`Error in stream ${streamId}:`, error);
});

// Close multiplexer when done
// multiplexer.close();
```

On the receiving end, you can use the `T140StreamDemultiplexer` to extract the original streams:

```typescript
import { T140StreamDemultiplexer } from "t140llm";
import * as dgram from "dgram";

// Create a UDP socket to receive RTP packets
const socket = dgram.createSocket('udp4');

// Create demultiplexer
const demultiplexer = new T140StreamDemultiplexer();

// Process incoming RTP packets
socket.on('message', (msg) => {
  // Process the packet through the demultiplexer
  demultiplexer.processPacket(msg, true); // Use true for CSRC-based identification
});

// Listen for new streams
demultiplexer.on('stream', (streamId, stream) => {
  console.log(`New stream detected: ${streamId}`);
  
  // Handle this stream's data
  stream.on('data', (text) => {
    console.log(`[${streamId}] ${text}`);
  });
  
  stream.on('metadata', (metadata) => {
    console.log(`[${streamId}] Metadata:`, metadata);
  });
});

// Bind socket to listen for packets
socket.bind(5004);
```

The multiplexing feature provides two methods for identifying streams:

1. **CSRC field identification** (recommended): Uses the RTP CSRC field to carry stream identifiers
2. **Prefix-based identification**: Prepends each payload with a stream identifier

See the [examples/multiplexed_streams_example.js](examples/multiplexed_streams_example.js) file for a complete example of multiplexing multiple LLM streams.

#### With Reasoning Stream Processing

Some LLM providers can stream their reasoning process as separate metadata alongside the generated text. This allows applications to show both the LLM's thought process and its final output:

```typescript
import { processAIStream } from "t140llm";
import Anthropic from "@anthropic-ai/sdk";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Create a streaming response with reasoning
const stream = await anthropic.messages.create({
  model: "claude-3-sonnet-20240229",
  messages: [{ role: "user", content: "Solve this math problem: 2x + 5 = 13" }],
  stream: true,
});

// Create a custom reasoning handler
const handleReasoning = (metadata) => {
  if (metadata.type === "reasoning") {
    console.log("REASONING:", metadata.content);
  }
};

// Process the stream with reasoning handling
processAIStream(stream, "ws://localhost:3000", {
  handleMetadata: true,
  metadataCallback: handleReasoning,
  sendMetadataOverWebsocket: true, // Also send reasoning over WebSocket
});
```

For more advanced usage, including separate transports for text and reasoning, see the [examples/reasoning_example.js](examples/reasoning_example.js) and [examples/reasoning_direct_socket_example.js](examples/reasoning_direct_socket_example.js) examples.

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
your quality of experience when latency is a particularly sensitive measurement. Typically you can expect at minimum a 10% reduction in latency compared with websockets.

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
- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send RTP packets to. Only used if no custom transport is provided.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send RTP packets to. Defaults to `5004`. Only used if no custom transport is provided.
- `rtpConfig` <RtpConfig> Optional. Configuration options for RTP:
  - `payloadType` <[number][number-mdn-url]> Optional. The RTP payload type. Defaults to `96`.
  - `ssrc` <[number][number-mdn-url]> Optional. The RTP synchronization source. Defaults to a cryptographically secure random value.
  - `initialSequenceNumber` <[number][number-mdn-url]> Optional. The initial sequence number. Defaults to `0`.
  - `initialTimestamp` <[number][number-mdn-url]> Optional. The initial timestamp. Defaults to `0`.
  - `timestampIncrement` <[number][number-mdn-url]> Optional. The timestamp increment per packet. Defaults to `160`.
  - `fecEnabled` <[boolean][boolean-mdn-url]> Optional. Enable Forward Error Correction. Defaults to `false`.
  - `fecPayloadType` <[number][number-mdn-url]> Optional. The payload type for FEC packets. Defaults to `97`.

### createT140WebSocketConnection(websocketUrl, [options])

- `websocketUrl` <[string][string-mdn-url]> Optional. WebSocket URL to connect to. Defaults to `ws://localhost:8765`.
- `options` <Object> Optional. Configuration options:
  - `tlsOptions` <Object> Optional. SSL/TLS options for secure WebSocket connections.
- returns: <Object> An object containing:
  - `connection` <WebSocket> The WebSocket connection
  - `attachStream` <Function> A function to attach a TextDataStream to this connection

Creates a WebSocket connection that can be used for T.140 transport. This allows establishing the connection before the LLM stream is available.

### createDirectSocketTransport(socketPath, [rtpConfig])

- `socketPath` <[string][string-mdn-url]> Optional. Path to the SEQPACKET socket. Defaults to the library's default socket path.
- `rtpConfig` <RtpConfig> Optional. Configuration options for RTP (same as in processAIStreamToRtp).
- returns: <Object> An object containing:
  - `transport` <Socket|TransportStream> The direct socket or custom transport
  - `attachStream` <Function> A function to attach a TextDataStream to this transport
  - `rtpState` <Object> Current RTP state (sequence number, timestamp, ssrc)

Creates a direct socket transport that can be used for T.140 RTP transmission. This allows establishing the connection before the LLM stream is available.

### createT140RtpTransport(remoteAddress, [remotePort], [rtpConfig])

- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send RTP packets to.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send RTP packets to. Defaults to `5004`.
- `rtpConfig` <RtpConfig> Optional. Configuration options for RTP (same as in processAIStreamToRtp).
- returns: <Object> An object containing:
  - `transport` <T140RtpTransport> The RTP transport instance
  - `attachStream` <Function> A function to attach a TextDataStream to this transport

Creates an RTP transport that can be used for T.140 transmission. This allows establishing the connection before the LLM stream is available.

### createT140SrtpTransport(remoteAddress, srtpConfig, [remotePort])

- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send SRTP packets to.
- `srtpConfig` <SrtpConfig> SRTP configuration with master key and salt.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send SRTP packets to. Defaults to `5006`.
- returns: <Object> An object containing:
  - `transport` <T140RtpTransport> The RTP transport instance configured for SRTP
  - `attachStream` <Function> A function to attach a TextDataStream to this transport

Creates an SRTP transport that can be used for secure T.140 transmission. This allows establishing the connection before the LLM stream is available.

### createT140RtpMultiplexer(remoteAddress, [remotePort], [multiplexConfig])

- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send multiplexed packets to.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send multiplexed packets to. Defaults to `5004`.
- `multiplexConfig` <RtpConfig> Optional. Configuration options for the multiplexer:
  - `multiplexEnabled` <[boolean][boolean-mdn-url]> Required. Set to `true` to enable multiplexing.
  - `useCsrcForStreamId` <[boolean][boolean-mdn-url]> Optional. Use CSRC field for stream identification. Defaults to `false`.
  - `charRateLimit` <[number][number-mdn-url]> Optional. Character rate limit for all streams combined. Defaults to `30`.
  - All other RTP configuration options are also supported.
- returns: <T140RtpMultiplexer> The multiplexer instance.

Creates a multiplexer that can combine multiple LLM streams into a single RTP output.

### processAIStreamToRtp(stream, remoteAddress, [remotePort], [rtpConfig])

- `stream` <TextDataStream> The streaming data source that emits text chunks.
- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send RTP packets to.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send RTP packets to. Defaults to `5004`.
- `rtpConfig` <RtpConfig> Optional. Configuration options for RTP:
  - `payloadType` <[number][number-mdn-url]> Optional. The RTP payload type. Defaults to `96`.
  - `ssrc` <[number][number-mdn-url]> Optional. The RTP synchronization source. Defaults to a cryptographically secure random value.
  - `initialSequenceNumber` <[number][number-mdn-url]> Optional. The initial sequence number. Defaults to `0`.
  - `initialTimestamp` <[number][number-mdn-url]> Optional. The initial timestamp. Defaults to `0`.
  - `timestampIncrement` <[number][number-mdn-url]> Optional. The timestamp increment per packet. Defaults to `160`.
  - `fecEnabled` <[boolean][boolean-mdn-url]> Optional. Enable Forward Error Correction. Defaults to `false`.
  - `fecPayloadType` <[number][number-mdn-url]> Optional. The payload type for FEC packets. Defaults to `97`.
  - `fecGroupSize` <[number][number-mdn-url]> Optional. Number of media packets to protect with one FEC packet. Defaults to `5`.
  - `customTransport` <TransportStream> Optional. A custom transport implementation to use instead of the default UDP socket.
- returns: <T140RtpTransport> The transport object that can be used to close the connection.

Processes an AI stream and sends the text chunks directly as T.140 data over RTP. When FEC is enabled, it adds Forward Error Correction packets according to RFC 5109 to help recover from packet loss. If a custom transport is provided, it will be used instead of creating a UDP socket.

### processAIStreamToSrtp(stream, remoteAddress, srtpConfig, [remotePort])

- `stream` <TextDataStream> The streaming data source that emits text chunks.
- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send SRTP packets to. Only used if no custom transport is provided.
- `srtpConfig` <SrtpConfig> SRTP configuration including master key and salt.
  - `masterKey` <Buffer> Required. The SRTP master key.
  - `masterSalt` <Buffer> Required. The SRTP master salt.
  - `profile` <[number][number-mdn-url]> Optional. The SRTP crypto profile.
  - `customTransport` <TransportStream> Optional. A custom transport implementation to use instead of the default UDP socket.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send SRTP packets to. Defaults to `5006`. Only used if no custom transport is provided.
- returns: <T140RtpTransport> The transport object that can be used to close the connection.

Processes an AI stream and sends the text chunks directly as T.140 data over secure SRTP. If a custom transport is provided, it will be used instead of creating a UDP socket.

### processAIStreamsToMultiplexedRtp(streams, remoteAddress, [remotePort], [rtpConfig])

- `streams` <Map<string, TextDataStream>> A map of stream IDs to TextDataStream instances.
- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send RTP packets to.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send RTP packets to. Defaults to `5004`.
- `rtpConfig` <RtpConfig> Optional. Configuration options for RTP, including multiplexing options:
  - `multiplexEnabled` <[boolean][boolean-mdn-url]> Required. Set to `true` to enable multiplexing.
  - `useCsrcForStreamId` <[boolean][boolean-mdn-url]> Optional. Use CSRC field for stream identification. Defaults to `false`.
  - All other RTP configuration options are also supported.
- returns: <T140RtpMultiplexer> The multiplexer instance.

Processes multiple AI streams and combines them into a single multiplexed RTP output.

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

- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send packets to. Only used if no custom transport is provided.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send packets to. Defaults to `5004`. Only used if no custom transport is provided.
- `config` <RtpConfig> Optional. Configuration options for RTP, including FEC options and custom transport.
  - `customTransport` <TransportStream> Optional. A custom transport implementation to use instead of the default UDP socket.

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

Closes the UDP socket or custom transport and cleans up resources. If FEC is enabled, it will send any remaining FEC packets before closing.

### T140RtpMultiplexer

A class that manages multiple LLM streams and multiplexes them into a single RTP output.

#### constructor(remoteAddress, [remotePort], [config])

- `remoteAddress` <[string][string-mdn-url]> The remote IP address to send packets to.
- `remotePort` <[number][number-mdn-url]> Optional. The remote port to send packets to. Defaults to `5004`.
- `config` <RtpConfig> Optional. Configuration options for the multiplexer.

#### addStream(id, stream, [streamConfig], [processorOptions])

- `id` <[string][string-mdn-url]> Unique identifier for this stream.
- `stream` <TextDataStream> The stream to add to the multiplexer.
- `streamConfig` <RtpConfig> Optional. Configuration options specific to this stream.
- `processorOptions` <ProcessorOptions> Optional. Options for processing this stream.
- returns: <[boolean][boolean-mdn-url]> `true` if the stream was added successfully, `false` otherwise.

Adds a new stream to the multiplexer.

#### removeStream(id)

- `id` <[string][string-mdn-url]> ID of the stream to remove.
- returns: <[boolean][boolean-mdn-url]> `true` if the stream was found and removed, `false` otherwise.

Removes a stream from the multiplexer.

#### getStreamCount()

- returns: <[number][number-mdn-url]> The number of active streams.

Returns the number of active streams in the multiplexer.

#### getStreamIds()

- returns: <Array<[string][string-mdn-url]>> Array of active stream IDs.

Returns an array of all active stream IDs.

#### close()

- returns: <void>

Closes the multiplexer and all streams.

#### Events

- `streamAdded` - Emitted when a new stream is added to the multiplexer.
- `streamRemoved` - Emitted when a stream is removed from the multiplexer.
- `streamError` - Emitted when an error occurs with a specific stream.
- `metadata` - Emitted when metadata is received from any stream.
- `error` - Emitted when an error occurs with the multiplexer itself.

### T140StreamDemultiplexer

A class that extracts individual streams from multiplexed RTP packets.

#### constructor()

Creates a new demultiplexer instance.

#### processPacket(data, useCSRC)

- `data` <Buffer> Buffer containing RTP packet data.
- `useCSRC` <[boolean][boolean-mdn-url]> Optional. Whether to use CSRC fields for stream identification. Defaults to `false`.
- returns: <void>

Processes an RTP packet and extracts stream information.

#### getStream(streamId)

- `streamId` <[string][string-mdn-url]> The stream ID to retrieve.
- returns: <DemultiplexedStream|undefined> The demultiplexed stream if found, `undefined` otherwise.

Gets a demultiplexed stream by ID.

#### getStreamIds()

- returns: <Array<[string][string-mdn-url]>> Array of detected stream IDs.

Returns an array of all detected stream IDs.

#### Events

- `stream` - Emitted when a new stream is detected.
- `data` - Emitted for all demultiplexed data with streamId, text, and metadata.
- `error` - Emitted when an error occurs during packet processing.

### TransportStream Interface

An interface that custom transport implementations must follow to be compatible with T140RtpTransport.

#### send(data, callback)

- `data` <Buffer> The packet data to send.
- `callback` <Function> Optional. Called when the packet has been sent or if an error occurred.
  - `error` <Error> Optional. The error that occurred during sending, if any.
- returns: <void>

Sends a packet through the transport.

#### close()

- returns: <void>

Optional method to close the transport and clean up resources.

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
[tm]: https://github.com/agrathwohl/t140llm/blob/master/examples/baudot_ita2_tty_example.js
[ad]: https://github.com/agrathwohl/assistive-llm
[sat]: https://github.com/agrathwohl/t140llm/blob/master/examples/fec_demo.js
