# Async Iterator Support — Implementation Workflow

**Date:** 2026-02-23
**Prerequisite:** Phases 0–5 complete (185/185 tests passing)
**Breaking Changes:** None (backward compatible)
**Estimated Effort:** 1–2 days

---

## Problem Statement

Every major LLM SDK (OpenAI, Anthropic, Vercel AI, Gemini, Cohere, Mistral, Ollama) returns `AsyncIterable` streams. None emit `.on('data')` events. The current `TextDataStream extends EventEmitter` interface forces users to wrap SDK streams in an EventEmitter adapter before passing them to t140llm — an unnecessary and error-prone step that contradicts the library's purpose of making LLM-to-RTP streaming easy.

### SDK Streaming Patterns

| SDK | Return Type | Iteration Pattern |
|-----|-----------|-------------------|
| OpenAI | `Stream<ChatCompletionChunk>` | `for await (const chunk of stream)` |
| Anthropic | `MessageStream` | `for await (const event of stream)` |
| Vercel AI SDK | `StreamTextResult` | `for await (const part of result.textStream)` |
| Google Gemini | `GenerateContentStreamResult` | `for await (const chunk of result.stream)` |
| Cohere | `StreamedChatResponse` | `for await (const event of stream)` |
| Mistral | `ChatCompletionResponse` | `for await (const chunk of stream)` |
| Ollama | `AsyncGenerator` | `for await (const part of response)` |

All implement `Symbol.asyncIterator`. None implement `EventEmitter`.

---

## Current Architecture

### TextDataStream Interface

```typescript
// src/interfaces/text-data-stream.interface.ts
import { EventEmitter } from 'events';
export interface TextDataStream extends EventEmitter {
  // Relies on: .on('data'), .on('end'), .on('error'), .on('metadata')
}
```

### Stream Consumption Sites (3 total in src/)

| File | Lines | Pattern | Role |
|------|-------|---------|------|
| `src/utils/stream-processor.ts` | 77, 110, 118 | `.on('data')`, `.on('end')`, `.on('error')` | Shared processor — ALL 5 processors delegate here |
| `src/rtp/t140-rtp-multiplexer.ts` | 247, 276, 280 | `.on('data')`, `.on('end')`, `.on('error')` | Independent stream handling in `addStream()` |
| `src/utils/demultiplex-streams.ts` | 42, 46, 50, 54 | `.emit('data')`, `.emit('metadata')`, `.emit('end')`, `.emit('error')` | **PRODUCER** only — emits events, does not consume |

### Key Insight: Only 2 Consumption Points Need Changes

1. **`attachStreamProcessor()`** in `stream-processor.ts` — serves all 5 processor functions
2. **`addStream()`** in `t140-rtp-multiplexer.ts` — independent multiplexer path

The demultiplexer is a **producer** of EventEmitter streams (it `.emit()`s events for downstream consumers to `.on()`). It stays EventEmitter — that's the correct pattern for a source.

### Chunk Parsing: No Changes Needed

`extractTextFromChunk()` in `src/utils/extract-text.ts` already handles all 9 chunk shapes yielded by modern LLM SDKs:
- `chunk.choices[0].delta.content` (OpenAI, Mistral, Vercel)
- `chunk.delta.text` (Anthropic)
- `chunk.text` (Cohere)
- `chunk.candidates[0].content.parts[0].text` (Gemini)
- `chunk.response` (Ollama)
- `chunk.content` (generic)
- `chunk.message.content` (generic)
- Raw string chunks
- Buffer chunks

These are the exact shapes yielded by `for await (const chunk of stream)`. **No changes needed to chunk parsing logic.**

---

## Design

### TextDataStream: Union Type

```typescript
import { EventEmitter } from 'events';

/**
 * A stream of text data from an LLM or other source.
 *
 * Accepts either:
 * - An EventEmitter that emits 'data', 'end', 'error', and optionally 'metadata' events
 * - An AsyncIterable that yields chunks (for modern LLM SDKs)
 */
export type TextDataStream = EventEmitter | AsyncIterable<unknown>;
```

### Detection: `Symbol.asyncIterator`

```typescript
function isAsyncIterable(stream: TextDataStream): stream is AsyncIterable<unknown> {
  return stream != null && typeof (stream as any)[Symbol.asyncIterator] === 'function';
}
```

This check is reliable: all 7 LLM SDKs implement `Symbol.asyncIterator`. EventEmitters do not (unless explicitly added). Node.js Readable streams implement both — the async iterator path is preferred for those since it handles backpressure correctly.

### Metadata Handling

With EventEmitter streams, metadata arrives via `stream.emit('metadata', metadata)`. AsyncIterables have no side-channel — metadata is embedded in yielded chunks.

**Solution:** `extractTextFromChunk()` already extracts metadata from chunks and returns `{ text, metadata }`. The async iterator path uses this existing extraction. No separate metadata event needed — the chunks themselves carry metadata.

For explicit metadata-only events (e.g., tool calls without text), the extraction returns `{ text: '', metadata: { type: 'tool_call', ... } }`. The processor already handles empty text (skips send, still invokes metadataCallback).

### Error Handling

AsyncIterable errors manifest as thrown exceptions inside `for await`. The try/catch in the async consumption function maps directly to the existing `stream.on('error')` handler behavior.

---

## Implementation Plan

### Step 1: Update TextDataStream Interface

**File:** `src/interfaces/text-data-stream.interface.ts`

**Before:**
```typescript
import { EventEmitter } from 'events';
export interface TextDataStream extends EventEmitter {}
```

**After:**
```typescript
import { EventEmitter } from 'events';

/**
 * A stream of text data from an LLM or other source.
 *
 * Accepts either:
 * - An EventEmitter emitting 'data', 'end', 'error', and optionally 'metadata' events
 * - An AsyncIterable yielding chunks (for direct use with LLM SDK streams)
 */
export type TextDataStream = EventEmitter | AsyncIterable<unknown>;
```

**Impact:** This is a `type` change from `interface extends EventEmitter` to a union type alias. Every file that imports `TextDataStream` continues to work because:
- EventEmitter values still satisfy the type
- AsyncIterable values now also satisfy the type
- No file calls methods on `TextDataStream` directly — they all pass it to consumption functions

**Files affected by import (type-only, no code changes):**
- `src/interfaces/index.ts` — re-exports (no change needed, export works for types)
- `src/processors/process-ai-stream.ts` — parameter type
- `src/processors/process-ai-stream-to-rtp.ts` — parameter type
- `src/processors/process-ai-stream-to-srtp.ts` — parameter type
- `src/processors/process-ai-stream-to-direct-socket.ts` — parameter type
- `src/processors/process-ai-stream-to-multiplex.ts` — parameter type
- `src/utils/stream-processor.ts` — parameter type + consumption
- `src/rtp/t140-rtp-multiplexer.ts` — parameter type + consumption
- `src/utils/demultiplex-streams.ts` — parameter type (producer only)
- `src/__mocks__/index.ts` — parameter type in mock signatures

**Note on `interface` → `type`:** TypeScript allows `type` exports in the same way as `interface` exports. The `export type TextDataStream = ...` is valid and importable identically. However, consumers who do `class Foo implements TextDataStream` will break — you cannot `implements` a union type. Check: `DemultiplexedStreamImpl` in `demultiplex-streams.ts` — if it `implements TextDataStream`, it needs to `implements EventEmitter` instead (or `extends EventEmitter` which it likely already does).

---

### Step 2: Add Async Iterator Consumption to `attachStreamProcessor()`

**File:** `src/utils/stream-processor.ts`

This is the **critical change**. The shared processor currently has:

```typescript
export function attachStreamProcessor(
  stream: TextDataStream,
  transport: TransportStream,
  options: ProcessorOptions
): void {
  // ... setup ...
  stream.on('data', (chunk: unknown) => { /* extract, backspace, send */ });
  stream.on('end', () => { /* flush, close */ });
  stream.on('error', (err: Error) => { /* onError, close */ });
}
```

**After:** Add async iterator detection and consumption:

```typescript
import { EventEmitter } from 'events';
import { TextDataStream } from '../interfaces';

function isAsyncIterable(stream: TextDataStream): stream is AsyncIterable<unknown> {
  return stream != null && typeof (stream as any)[Symbol.asyncIterator] === 'function';
}

export function attachStreamProcessor(
  stream: TextDataStream,
  transport: TransportStream,
  options: ProcessorOptions
): void {
  // ... existing setup (backspace processor, rate limiter, etc.) ...

  if (isAsyncIterable(stream)) {
    consumeAsyncIterable(stream, transport, options, /* shared state */);
  } else {
    // Existing EventEmitter path — UNCHANGED
    stream.on('data', (chunk: unknown) => { /* ... */ });
    stream.on('end', () => { /* ... */ });
    stream.on('error', (err: Error) => { /* ... */ });
  }
}

async function consumeAsyncIterable(
  stream: AsyncIterable<unknown>,
  transport: TransportStream,
  options: ProcessorOptions,
  // Pass shared state: backspace processor, rate limiter, text buffer, etc.
): Promise<void> {
  try {
    for await (const chunk of stream) {
      // Reuse IDENTICAL logic from the 'data' handler:
      // 1. extractTextFromChunk(chunk) → { text, metadata }
      // 2. if metadata && metadataCallback → invoke callback (wrapped in try/catch)
      // 3. if text → backspace process → rate limit → transport.send()
    }
    // Stream exhausted = equivalent to 'end' event
    // Flush backspace buffer, close transport
  } catch (err) {
    // Equivalent to 'error' event
    // Invoke options.onError, close transport
  }
}
```

**Implementation detail:** The chunk processing logic (extract → metadata → backspace → rate limit → send) must be shared between both paths. Extract it into a local function:

```typescript
function processChunk(
  chunk: unknown,
  transport: TransportStream,
  options: ProcessorOptions,
  state: ProcessorState
): void {
  const { text, metadata } = extractTextFromChunk(chunk);

  if (metadata) {
    try { options.metadataCallback?.(metadata); }
    catch (e) { options.onError?.(e instanceof Error ? e : new Error(String(e))); }

    if (options.sendMetadataOverTransport) {
      const metadataJson = JSON.stringify(metadata);
      const metadataBuffer = Buffer.from(`MD:${metadataJson}`, 'utf-8');
      if (metadataBuffer.length <= MAX_METADATA_SIZE) {
        transport.send(metadataBuffer);
      }
    }
  }

  if (text) {
    const processed = state.backspaceEnabled
      ? processBackspaces(state.textBuffer + text)
      : text;
    // Rate limiting + transport.send()
  }
}
```

This `processChunk` function is then called from both `stream.on('data', chunk => processChunk(chunk, ...))` and `for await (const chunk of stream) { processChunk(chunk, ...); }`.

**Similarly, extract flush/close logic** into a shared function used by both the 'end' handler and the post-loop code.

---

### Step 3: Add Async Iterator Consumption to `T140RtpMultiplexer.addStream()`

**File:** `src/rtp/t140-rtp-multiplexer.ts`

The multiplexer has its own stream consumption in `addStream()`:

```typescript
addStream(streamId: string, stream: TextDataStream, config?: Partial<RtpConfig>): void {
  // ... setup ...
  stream.on('data', (chunk: unknown) => {
    const { text } = extractTextFromChunk(chunk);
    // grapheme-aware character queuing per stream
  });
  stream.on('end', () => { /* cleanup */ });
  stream.on('error', (err: Error) => { /* error handling */ });
}
```

**After:** Same pattern — detect and branch:

```typescript
addStream(streamId: string, stream: TextDataStream, config?: Partial<RtpConfig>): void {
  // ... existing setup ...

  if (isAsyncIterable(stream)) {
    this.consumeAsyncStream(streamId, stream);
  } else {
    // Existing EventEmitter path — UNCHANGED
    stream.on('data', (chunk: unknown) => { /* ... */ });
    stream.on('end', () => { /* ... */ });
    stream.on('error', (err: Error) => { /* ... */ });
  }
}

private async consumeAsyncStream(
  streamId: string,
  stream: AsyncIterable<unknown>
): Promise<void> {
  try {
    for await (const chunk of stream) {
      // Reuse identical logic from the 'data' handler
      const { text } = extractTextFromChunk(chunk);
      // grapheme-aware character queuing
    }
    // Stream exhausted → cleanup (same as 'end')
  } catch (err) {
    // Error → same as 'error' handler
  }
}
```

**Note:** The multiplexer's stream handling is simpler than the shared processor — no backspace processing, no rate limiting, no metadata callbacks. It only does text extraction + grapheme queuing. The async path is straightforward.

---

### Step 4: Verify `demultiplex-streams.ts` — No Changes

**File:** `src/utils/demultiplex-streams.ts`

`DemultiplexedStreamImpl` is a **producer** — it `extends EventEmitter` and `.emit()`s events. Downstream consumers `.on()` these events. This is the correct pattern for a source/producer.

**Verify:** `DemultiplexedStreamImpl` likely does `extends EventEmitter` or `implements TextDataStream`. If it `implements TextDataStream`, change to `extends EventEmitter` directly (since `TextDataStream` is now a union type, it can't be `implements`'d).

**Check:** Does any code pass a `DemultiplexedStreamImpl` back into a processor? If yes, it enters the EventEmitter path — correct behavior, no changes needed.

---

### Step 5: Verify Processor Files — Type Signatures Only

**Files:**
- `src/processors/process-ai-stream.ts`
- `src/processors/process-ai-stream-to-rtp.ts`
- `src/processors/process-ai-stream-to-srtp.ts`
- `src/processors/process-ai-stream-to-direct-socket.ts`
- `src/processors/process-ai-stream-to-multiplex.ts`

These all accept `stream: TextDataStream` and pass it to `attachStreamProcessor()`. Since `TextDataStream` is now a union type, these signatures automatically accept both EventEmitter and AsyncIterable. **No code changes needed in these files** — only verify they compile.

---

### Step 6: Update `index.d.ts`

**File:** `src/index.d.ts`

Update the `TextDataStream` declaration to match the new union type:

```typescript
// Before (if it exists as interface)
export interface TextDataStream extends EventEmitter {}

// After
export type TextDataStream = EventEmitter | AsyncIterable<unknown>;
```

Also ensure all processor function signatures use `TextDataStream` (they should already).

---

### Step 7: Update Mocks

**File:** `src/__mocks__/index.ts`

The 8 mock processor functions accept `stream: TextDataStream`. Since the type is now a union, the mocks accept both EventEmitter and AsyncIterable. The existing mock implementations use `stream.on('data', ...)` — this works when tests pass EventEmitters (which they will continue to do for existing tests).

**No changes required** unless we want mocks to also handle async iterables. For now, existing tests pass EventEmitters → mocks work. New async iterator tests can create their own mocks or use real processor functions.

---

### Step 8: Update Tests

**Existing tests:** All existing tests create `new EventEmitter()` and pass to processors. These continue to work unchanged — the EventEmitter path is preserved.

**New tests to add:**

```typescript
// tests/async-iterator.test.ts

describe('AsyncIterable stream support', () => {
  it('processes async iterable stream via attachStreamProcessor', async () => {
    async function* mockLLMStream() {
      yield { choices: [{ delta: { content: 'Hello' } }] };  // OpenAI format
      yield { choices: [{ delta: { content: ' world' } }] };
    }

    const sent: Buffer[] = [];
    const transport: TransportStream = {
      send: (data: Buffer, cb?: (err?: Error) => void) => { sent.push(data); cb?.(); },
      close: jest.fn(),
    };

    attachStreamProcessor(mockLLMStream(), transport, {});

    // Wait for async consumption to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(sent.length).toBeGreaterThan(0);
    const text = Buffer.concat(sent).toString('utf-8');
    expect(text).toContain('Hello');
    expect(text).toContain('world');
  });

  it('handles async iterable errors', async () => {
    async function* failingStream() {
      yield { choices: [{ delta: { content: 'ok' } }] };
      throw new Error('LLM connection lost');
    }

    const onError = jest.fn();
    const transport: TransportStream = {
      send: jest.fn(),
      close: jest.fn(),
    };

    attachStreamProcessor(failingStream(), transport, { onError });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(transport.close).toHaveBeenCalled();
  });

  it('handles metadata from async iterable chunks', async () => {
    async function* streamWithMetadata() {
      yield {
        choices: [{ delta: { content: 'thinking...' } }],
        reasoning: 'internal reasoning text'
      };
    }

    const metadataCallback = jest.fn();
    const transport: TransportStream = {
      send: jest.fn(),
      close: jest.fn(),
    };

    attachStreamProcessor(streamWithMetadata(), transport, { metadataCallback });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(metadataCallback).toHaveBeenCalled();
  });

  it('processes async iterable in multiplexer addStream', async () => {
    // Test multiplexer path independently
    async function* mockStream() {
      yield { choices: [{ delta: { content: 'A' } }] };
      yield { choices: [{ delta: { content: 'B' } }] };
    }

    const multiplexer = new T140RtpMultiplexer('127.0.0.1', 5004, {});
    multiplexer.addStream('stream-1', mockStream());

    // Verify stream was accepted (multiplexer internals)
    // ...
  });

  it('works with real OpenAI-shaped async generator', async () => {
    // Simulate OpenAI's stream format
    async function* openaiStream() {
      yield { id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }] };
      yield { id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: '!' }, finish_reason: 'stop' }] };
    }
    // ... process and verify
  });

  it('works with real Anthropic-shaped async generator', async () => {
    async function* anthropicStream() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' there' } };
      yield { type: 'message_stop' };
    }
    // ... process and verify
  });

  it('backward compat: EventEmitter streams still work', () => {
    const stream = new EventEmitter();
    const transport: TransportStream = {
      send: jest.fn(),
      close: jest.fn(),
    };

    attachStreamProcessor(stream as TextDataStream, transport, {});

    stream.emit('data', { choices: [{ delta: { content: 'test' } }] });
    stream.emit('end');

    expect(transport.send).toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalled();
  });
});
```

---

### Step 9: Update Documentation

**Files:**
- `README.md` — Add async iterable usage examples
- `docs/index.html` — Update API reference, add LLM SDK examples

**README.md additions:**

```markdown
### Direct LLM SDK Usage

t140llm accepts streams from any LLM SDK directly — no wrapping needed:

#### OpenAI
```typescript
import OpenAI from 'openai';
import { processAIStreamToRtp } from 't140llm';

const openai = new OpenAI();
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true,
});

processAIStreamToRtp(stream, '192.168.1.100', 5004, { payloadType: 98 });
```

#### Anthropic
```typescript
import Anthropic from '@anthropic-ai/sdk';
import { processAIStreamToRtp } from 't140llm';

const anthropic = new Anthropic();
const stream = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true,
});

processAIStreamToRtp(stream, '192.168.1.100', 5004, { payloadType: 98 });
```

#### Vercel AI SDK
```typescript
import { streamText } from 'ai';
import { processAIStreamToRtp } from 't140llm';

const result = streamText({
  model: openai('gpt-4'),
  prompt: 'Hello!',
});

processAIStreamToRtp(result.textStream, '192.168.1.100', 5004, { payloadType: 98 });
```

EventEmitter-based streams continue to work unchanged.
```

---

## Execution Order

| Step | Description | Files Changed | Effort | Risk |
|------|-------------|---------------|--------|------|
| 1 | Update TextDataStream to union type | `text-data-stream.interface.ts` | 10m | Low |
| 2 | Add async path to `attachStreamProcessor()` | `stream-processor.ts` | 1–2h | Medium |
| 3 | Add async path to `T140RtpMultiplexer.addStream()` | `t140-rtp-multiplexer.ts` | 30m | Medium |
| 4 | Verify demultiplex-streams.ts (no changes expected) | `demultiplex-streams.ts` | 10m | None |
| 5 | Verify processor files compile | 5 processor files | 10m | None |
| 6 | Update index.d.ts | `index.d.ts` | 10m | Low |
| 7 | Verify mocks compile | `__mocks__/index.ts` | 10m | Low |
| 8 | Add async iterator tests | new `async-iterator.test.ts` | 1h | Low |
| 9 | Update docs | `README.md`, `docs/index.html` | 30m | None |

**Total estimated effort:** 3–5 hours

---

## Verification Checklist

- [ ] All 185 existing tests pass (backward compatibility)
- [ ] New async iterator tests pass
- [ ] `tsc --noEmit` produces no errors
- [ ] `npm run build` succeeds
- [ ] AsyncGenerator can be passed directly to all 5 `processAIStreamTo*` functions
- [ ] AsyncGenerator can be passed to `T140RtpMultiplexer.addStream()`
- [ ] EventEmitter streams still work in all paths
- [ ] Metadata extraction works from async iterable chunks
- [ ] Error handling works for async iterable failures
- [ ] Backspace buffer flushes correctly when async iterable ends
- [ ] Rate limiting works with async iterable input

---

## Edge Cases & Risks

### 1. Node.js Readable Streams

Node.js `Readable` implements **both** `EventEmitter` AND `Symbol.asyncIterator`. With the `isAsyncIterable` check first, Readable streams will take the async iterator path. This is actually **preferred** — async iteration on Readable handles backpressure correctly, while `.on('data')` does not.

However, if any existing code passes a `Readable` and relies on specific EventEmitter behavior (like `.pause()` / `.resume()` calls), this could be a behavioral change. **Mitigation:** Check if any code in the test suite or examples uses Readable streams with EventEmitter-specific methods.

### 2. `for await` and Unhandled Promise Rejections

The `consumeAsyncIterable` function is `async` and returns a `Promise<void>`. If called from synchronous code (which `attachStreamProcessor` is), the returned promise must be handled to avoid unhandled rejection warnings.

**Mitigation:** Add `.catch()` at the call site:

```typescript
if (isAsyncIterable(stream)) {
  consumeAsyncIterable(stream, transport, options, state).catch((err) => {
    options.onError?.(err);
    transport.close?.();
  });
} else {
  // EventEmitter path
}
```

This is the **defensive catch** — the `try/catch` inside `consumeAsyncIterable` should handle all errors, but this catch prevents unhandled rejection if something unexpected escapes.

### 3. Stream Cancellation

EventEmitter streams can be "cancelled" by removing listeners. AsyncIterable streams require the consumer to `break` out of the `for await` loop, which triggers the generator's `return()` method.

If the transport closes before the stream ends, we need to break the iteration:

```typescript
async function consumeAsyncIterable(...): Promise<void> {
  try {
    for await (const chunk of stream) {
      if (transportClosed) break;  // Exit if transport died
      processChunk(chunk, ...);
    }
  } catch (err) { /* ... */ }
}
```

### 4. `interface` → `type` Breaking Change

Changing `TextDataStream` from `interface` to `type` breaks any code that does:
```typescript
class MyStream implements TextDataStream { ... }
```

You cannot `implements` a union type in TypeScript. Check for this pattern in:
- `src/utils/demultiplex-streams.ts` — `DemultiplexedStreamImpl`
- Test files with `MockStream implements TextDataStream`

**Fix:** Change `implements TextDataStream` to `extends EventEmitter` (which is what they're doing anyway).

---

## Files Changed Summary

| File | Change Type | Description |
|------|------------|-------------|
| `src/interfaces/text-data-stream.interface.ts` | **MODIFY** | `interface extends EventEmitter` → `type = EventEmitter \| AsyncIterable<unknown>` |
| `src/utils/stream-processor.ts` | **MODIFY** | Add `isAsyncIterable()`, `consumeAsyncIterable()`, extract `processChunk()` |
| `src/rtp/t140-rtp-multiplexer.ts` | **MODIFY** | Add async iterator path in `addStream()` |
| `src/utils/demultiplex-streams.ts` | **VERIFY** | May need `implements TextDataStream` → `extends EventEmitter` |
| `src/index.d.ts` | **MODIFY** | Update TextDataStream declaration |
| `tests/async-iterator.test.ts` | **CREATE** | New test file for async iterator support |
| `tests/multiplexer.test.ts` | **VERIFY** | MockStream may need `implements` fix |
| `tests/multiplexing-e2e.test.ts` | **VERIFY** | MockStream may need `implements` fix |
| `README.md` | **MODIFY** | Add LLM SDK direct usage examples |
| `docs/index.html` | **MODIFY** | Update API reference |

**Files NOT changed (verified no impact):**
- `src/processors/*.ts` — type signatures auto-widen via union
- `src/utils/extract-text.ts` — already handles all chunk shapes
- `src/__mocks__/index.ts` — mock signatures auto-widen

---

*Generated: 2026-02-23*
*Depends on: Phases 0–5 complete, 185/185 tests passing*
