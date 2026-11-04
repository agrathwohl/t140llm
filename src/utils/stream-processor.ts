import { LLMMetadata, ProcessorOptions, TextDataStream } from '../interfaces';
import { processT140BackspaceChars } from './backspace-processing';
import { extractTextFromChunk } from './extract-text';

/**
 * Callbacks for transport-specific operations.
 * Each processor provides its own implementation of these.
 */
export interface StreamProcessorCallbacks {
  sendText: (text: string, graphemes?: string[]) => void;
  sendMetadata?: (metadata: LLMMetadata) => void;
  /** The source stream ended or failed. */
  close: () => void;
  onStreamEnd?: () => void;
}

/**
 * Resolved stream processing options with consistent defaults.
 */
export interface ResolvedStreamOptions {
  processBackspaces: boolean;
  handleMetadata: boolean;
  metadataCallback?: (metadata: LLMMetadata) => void;
  onError?: (error: Error) => void;
  sendMetadataOverTransport: boolean;
}

/**
 * Resolve stream processing options from processor options and transport config,
 * applying consistent defaults across all processors.
 *
 * @param processorOptions Options from the processor caller
 * @param configOptions Options from the transport config
 * @returns Resolved options with consistent defaults
 */
export function resolveStreamOptions(
  processorOptions: ProcessorOptions,
  configOptions?: {
    processBackspaces?: boolean;
    handleMetadata?: boolean;
    metadataCallback?: (metadata: LLMMetadata) => void;
    onError?: (error: Error) => void;
    sendMetadataOverTransport?: boolean;
  }
): ResolvedStreamOptions {
  return {
    processBackspaces:
      processorOptions.processBackspaces ??
      configOptions?.processBackspaces ??
      false,
    handleMetadata:
      (processorOptions.handleMetadata ?? configOptions?.handleMetadata) !==
      false,
    metadataCallback:
      processorOptions.metadataCallback ?? configOptions?.metadataCallback,
    onError: processorOptions.onError ?? configOptions?.onError,
    sendMetadataOverTransport:
      processorOptions.sendMetadataOverTransport ??
      configOptions?.sendMetadataOverTransport ??
      false,
  };
}

/**
 * Type guard to detect AsyncIterable streams (modern LLM SDK streams).
 */
export function isAsyncIterable(
  stream: TextDataStream
): stream is AsyncIterable<unknown> {
  return (
    stream != null &&
    typeof (stream as any)[Symbol.asyncIterator] === 'function'
  );
}

// ponytail: the backspace buffer only needs to know whether there is text left to
// erase, so keep a short tail instead of the whole conversation.
const BACKSPACE_BUFFER_TAIL = 256;

/**
 * Attach a stream to a transport via the shared processing pipeline.
 * Handles text extraction, metadata handling, backspace processing,
 * and error propagation for both EventEmitter and AsyncIterable streams.
 *
 * @param stream The stream to process
 * @param options Resolved processing options
 * @param callbacks Transport-specific callbacks
 * @returns A function that detaches from the stream. It removes only the
 *   listeners added here, or stops consuming an AsyncIterable.
 */
export function attachStreamProcessor(
  stream: TextDataStream,
  options: ResolvedStreamOptions,
  callbacks: StreamProcessorCallbacks
): () => void {
  let textBuffer = '';
  let detached = false;

  const handleChunk = (chunk: unknown, emitMetadata?: (metadata: LLMMetadata) => void): void => {
    const { text, metadata } = extractTextFromChunk(chunk, options.handleMetadata);

    if (options.handleMetadata && metadata) {
      emitMetadata?.(metadata);
      try {
        options.metadataCallback?.(metadata);
      } catch (_cbErr) {
        // A throwing callback must not stop the text.
      }
      if (options.sendMetadataOverTransport) {
        callbacks.sendMetadata?.(metadata);
      }
    }

    if (!text) return;

    if (!options.processBackspaces) {
      callbacks.sendText(text);
      return;
    }

    const result = processT140BackspaceChars(text, textBuffer);
    textBuffer = Array.from(result.updatedBuffer).slice(-BACKSPACE_BUFFER_TAIL).join('');
    if (result.processedText) {
      callbacks.sendText(result.processedText, result.processedGraphemes);
    }
  };

  const finish = (): void => {
    callbacks.onStreamEnd?.();
    callbacks.close();
  };

  const fail = (err: unknown): void => {
    options.onError?.(err instanceof Error ? err : new Error(String(err)));
    callbacks.close();
  };

  if (isAsyncIterable(stream)) {
    (async () => {
      for await (const chunk of stream) {
        if (detached) break; // break calls the iterator's return()
        handleChunk(chunk);
      }
      if (!detached) finish();
    })().catch(fail);
    return () => { detached = true; };
  }

  const onData = (chunk: unknown): void => {
    handleChunk(chunk, (metadata) => stream.emit('metadata', metadata));
  };
  stream.on('data', onData);
  stream.on('end', finish);
  stream.on('error', fail);
  return () => {
    stream.off('data', onData);
    stream.off('end', finish);
    stream.off('error', fail);
  };
}
