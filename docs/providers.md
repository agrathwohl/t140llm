# Provider guide

Every provider works the same way: create a streaming completion with the SDK you already use, then hand the stream to `processAIStream` (or any `processAIStreamTo*` transport). `t140llm` accepts both EventEmitter- and async-iterable-shaped streams, so most SDK stream objects pass through directly.

```typescript
import { processAIStream } from "t140llm";

const stream = await /* any streaming completion below */;
processAIStream(stream); // or processAIStreamToRtp(stream, host, port), etc.
```

Only the client setup differs. The snippets below show just that part.

## OpenAI

```typescript
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

processAIStream(stream);
```

## Anthropic Claude

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const stream = await anthropic.messages.create({
  model: "claude-3-sonnet-20240229",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

processAIStream(stream);
```

## Google Gemini

Gemini returns an async iterable — pass `result.stream` directly, no wrapper needed.

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });
const result = await model.startChat().sendMessageStream("Write a short story.");

processAIStream(result.stream);
```

## Mistral

```typescript
import MistralClient from "@mistralai/mistralai";

const mistral = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY });

const stream = await mistral.chat({
  model: "mistral-large-latest",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

processAIStream(stream);
```

## Cohere

```typescript
import { CohereClient } from "cohere-ai";

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

const stream = await cohere.chatStream({
  model: "command",
  message: "Write a short story.",
});

processAIStream(stream);
```

## Ollama

```typescript
import { Ollama } from "ollama";

const ollama = new Ollama();

const stream = await ollama.chat({
  model: "llama3",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

processAIStream(stream);
```

## Vercel AI SDK

Inside a route handler, process the stream with `t140llm` and still return it to the client:

```typescript
import { StreamingTextResponse, Message } from "ai";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { messages }: { messages: Message[] } = await req.json();

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages,
    stream: true,
  });

  processAIStream(response);
  return new StreamingTextResponse(response);
}
```

## Reasoning streams

Some providers stream their reasoning as separate metadata alongside the output. Handle it with a metadata callback:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const stream = await anthropic.messages.create({
  model: "claude-3-sonnet-20240229",
  messages: [{ role: "user", content: "Solve: 2x + 5 = 13" }],
  stream: true,
});

processAIStream(stream, "ws://localhost:3000", {
  handleMetadata: true,
  metadataCallback: (meta) => {
    if (meta.type === "reasoning") console.log("REASONING:", meta.content);
  },
  sendMetadataOverWebsocket: true,
});
```

For separate transports for text and reasoning, see
[`examples/reasoning_example.js`](https://github.com/agrathwohl/t140llm/blob/master/examples/reasoning_example.js) and
[`examples/reasoning_direct_socket_example.js`](https://github.com/agrathwohl/t140llm/blob/master/examples/reasoning_direct_socket_example.js).

## Support matrix

| Provider / feature | Supported |
| --- | --- |
| OpenAI | ✅ |
| Anthropic | ✅ |
| Google Gemini | ✅ |
| Mistral | ✅ |
| Cohere | ✅ |
| Ollama | ✅ |
| Vercel AI SDK | ✅ |
| Reasoning streams | ✅ |
| Tool calls | ✅ |
| Output metadata | ✅ |
| Amazon Bedrock | ⬜ planned |
| Images / video / PDFs | ⬜ planned |
