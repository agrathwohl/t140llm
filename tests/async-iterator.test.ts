import { EventEmitter } from 'events';
import { TextDataStream, ProcessorOptions } from '../src/interfaces';
import {
  attachStreamProcessor,
  resolveStreamOptions,
  StreamProcessorCallbacks,
  ResolvedStreamOptions,
} from '../src/utils/stream-processor';

// Helper to create resolved options with defaults
function defaultOptions(overrides: ProcessorOptions = {}): ResolvedStreamOptions {
  return resolveStreamOptions(overrides);
}

// Helper to create mock callbacks that track calls
function mockCallbacks(): StreamProcessorCallbacks & {
  sentTexts: string[];
  closed: boolean;
  streamEnded: boolean;
} {
  const cb: StreamProcessorCallbacks & {
    sentTexts: string[];
    closed: boolean;
    streamEnded: boolean;
  } = {
    sentTexts: [],
    closed: false,
    streamEnded: false,
    sendText: (text: string) => { cb.sentTexts.push(text); },
    close: () => { cb.closed = true; },
    onStreamEnd: () => { cb.streamEnded = true; },
  };
  return cb;
}

describe('AsyncIterable stream support', () => {
  it('processes async iterable stream via attachStreamProcessor', async () => {
    async function* mockLLMStream() {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' world' } }] };
    }

    const callbacks = mockCallbacks();
    attachStreamProcessor(mockLLMStream(), defaultOptions(), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(callbacks.sentTexts.join('')).toBe('Hello world');
    expect(callbacks.closed).toBe(true);
    expect(callbacks.streamEnded).toBe(true);
  });

  it('handles async iterable errors', async () => {
    async function* failingStream() {
      yield { choices: [{ delta: { content: 'ok' } }] };
      throw new Error('LLM connection lost');
    }

    const onError = jest.fn();
    const callbacks = mockCallbacks();
    attachStreamProcessor(failingStream(), defaultOptions({ onError }), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe('LLM connection lost');
    expect(callbacks.closed).toBe(true);
  });

  it('handles metadata from async iterable chunks', async () => {
    async function* streamWithMetadata() {
      yield {
        choices: [{ delta: { content: 'thinking...', reasoning: 'internal reasoning text' } }],
      };
    }

    const metadataCallback = jest.fn();
    const callbacks = mockCallbacks();
    attachStreamProcessor(
      streamWithMetadata(),
      defaultOptions({ handleMetadata: true, metadataCallback }),
      callbacks
    );

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(metadataCallback).toHaveBeenCalled();
    expect(callbacks.sentTexts.join('')).toContain('thinking...');
  });

  it('works with OpenAI-shaped async generator', async () => {
    async function* openaiStream() {
      yield { id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }] };
      yield { id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: '!' }, finish_reason: 'stop' }] };
    }

    const callbacks = mockCallbacks();
    attachStreamProcessor(openaiStream(), defaultOptions(), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(callbacks.sentTexts.join('')).toBe('Hi!');
    expect(callbacks.closed).toBe(true);
  });

  it('works with Anthropic-shaped async generator', async () => {
    async function* anthropicStream() {
      yield { delta: { text: 'Hello' } };
      yield { delta: { text: ' there' } };
    }

    const callbacks = mockCallbacks();
    attachStreamProcessor(anthropicStream(), defaultOptions(), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(callbacks.sentTexts.join('')).toBe('Hello there');
    expect(callbacks.closed).toBe(true);
  });

  it('works with Gemini-shaped async generator', async () => {
    async function* geminiStream() {
      yield { candidates: [{ content: { parts: [{ text: 'Greetings' }] } }] };
      yield { candidates: [{ content: { parts: [{ text: ' human' }] } }] };
    }

    const callbacks = mockCallbacks();
    attachStreamProcessor(geminiStream(), defaultOptions(), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(callbacks.sentTexts.join('')).toBe('Greetings human');
  });

  it('works with Ollama-shaped async generator', async () => {
    async function* ollamaStream() {
      yield { response: 'Hey' };
      yield { response: ' there' };
    }

    const callbacks = mockCallbacks();
    attachStreamProcessor(ollamaStream(), defaultOptions(), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(callbacks.sentTexts.join('')).toBe('Hey there');
  });

  it('works with raw string chunks', async () => {
    async function* stringStream() {
      yield 'Hello';
      yield ' world';
    }

    const callbacks = mockCallbacks();
    attachStreamProcessor(stringStream(), defaultOptions(), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(callbacks.sentTexts.join('')).toBe('Hello world');
  });

  it('skips chunks with no text content', async () => {
    async function* sparseStream() {
      yield { choices: [{ delta: { content: '' } }] };
      yield { choices: [{ delta: { content: 'data' } }] };
    }

    const callbacks = mockCallbacks();
    attachStreamProcessor(sparseStream(), defaultOptions(), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(callbacks.sentTexts).toEqual(['data']);
  });

  it('handles empty async iterable (no chunks)', async () => {
    async function* emptyStream() {
      // yields nothing
    }

    const callbacks = mockCallbacks();
    attachStreamProcessor(emptyStream(), defaultOptions(), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(callbacks.sentTexts).toEqual([]);
    expect(callbacks.closed).toBe(true);
    expect(callbacks.streamEnded).toBe(true);
  });

  it('wraps non-Error thrown values in Error', async () => {
    async function* throwsString() {
      yield 'ok';
      throw 'string error';  // eslint-disable-line no-throw-literal
    }

    const onError = jest.fn();
    const callbacks = mockCallbacks();
    attachStreamProcessor(throwsString(), defaultOptions({ onError }), callbacks);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('string error');
  });

  it('protects against metadata callback exceptions', async () => {
    async function* streamWithMetadata() {
      yield {
        choices: [{ delta: { content: 'text', reasoning: 'some reasoning' } }],
      };
    }

    const throwingCallback = () => { throw new Error('callback boom'); };
    const callbacks = mockCallbacks();
    attachStreamProcessor(
      streamWithMetadata(),
      defaultOptions({ handleMetadata: true, metadataCallback: throwingCallback }),
      callbacks
    );

    await new Promise(resolve => setTimeout(resolve, 50));

    // Should not crash — text should still be processed
    expect(callbacks.sentTexts.join('')).toContain('text');
    expect(callbacks.closed).toBe(true);
  });

  it('backward compat: EventEmitter streams still work', () => {
    const stream = new EventEmitter();
    const callbacks = mockCallbacks();
    attachStreamProcessor(stream as TextDataStream, defaultOptions(), callbacks);

    stream.emit('data', { choices: [{ delta: { content: 'test' } }] });
    stream.emit('end');

    expect(callbacks.sentTexts).toEqual(['test']);
    expect(callbacks.closed).toBe(true);
    expect(callbacks.streamEnded).toBe(true);
  });

  it('EventEmitter error handling still works', () => {
    const stream = new EventEmitter();
    const onError = jest.fn();
    const callbacks = mockCallbacks();
    attachStreamProcessor(stream as TextDataStream, defaultOptions({ onError }), callbacks);

    const error = new Error('stream broke');
    stream.emit('error', error);

    expect(onError).toHaveBeenCalledWith(error);
    expect(callbacks.closed).toBe(true);
  });
});
