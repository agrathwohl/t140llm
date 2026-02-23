import { LLMMetadata, ProcessorOptions, TextDataStream } from '../interfaces';
import { processT140BackspaceChars } from './backspace-processing';
import { extractTextFromChunk } from './extract-text';

/**
 * Callbacks for transport-specific operations.
 * Each processor provides its own implementation of these.
 */
export interface StreamProcessorCallbacks {
  /** Send text through the transport */
  sendText: (text: string) => void;
  /** Send metadata through the transport (optional) */
  sendMetadata?: (metadata: LLMMetadata) => void;
  /** Close the transport and cleanup resources */
  close: () => void;
  /** Called after buffer flush on stream end, before close */
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
 * @param configOptions Options from the transport config (RtpConfig, SrtpConfig, etc.)
 * @returns Resolved options with consistent defaults
 */
export function resolveStreamOptions(
  processorOptions: ProcessorOptions,
  configOptions?: {
    processBackspaces?: boolean;
    handleMetadata?: boolean;
    metadataCallback?: (metadata: LLMMetadata) => void;
    sendMetadataOverTransport?: boolean;
  }
): ResolvedStreamOptions {
  return {
    processBackspaces:
      processorOptions.processBackspaces ?? configOptions?.processBackspaces ?? false,
    handleMetadata:
      (processorOptions.handleMetadata ?? configOptions?.handleMetadata) !== false,
    metadataCallback:
      processorOptions.metadataCallback ?? configOptions?.metadataCallback,
    onError: processorOptions.onError,
    sendMetadataOverTransport:
      processorOptions.sendMetadataOverTransport ?? configOptions?.sendMetadataOverTransport ?? false,
  };
}

/**
 * Attach a stream to a transport via the shared processing pipeline.
 * Handles text extraction, metadata handling, backspace processing,
 * buffer flushing, and error propagation.
 *
 * @param stream The stream to process
 * @param options Resolved processing options
 * @param callbacks Transport-specific callbacks
 */
export function attachStreamProcessor(
  stream: TextDataStream,
  options: ResolvedStreamOptions,
  callbacks: StreamProcessorCallbacks
): void {
  let textBuffer = '';

  stream.on('data', (chunk: unknown) => {
    const { text, metadata } = extractTextFromChunk(chunk);

    if (options.handleMetadata && metadata) {
      stream.emit('metadata', metadata);
      try {
        options.metadataCallback?.(metadata);
      } catch (_cbErr) {
        // Prevent callback exceptions from crashing the stream pipeline
      }

      if (options.sendMetadataOverTransport && callbacks.sendMetadata) {
        callbacks.sendMetadata(metadata);
      }
    }

    if (!text) return;

    let textToSend = text;

    if (options.processBackspaces) {
      const { processedText, updatedBuffer } = processT140BackspaceChars(
        text,
        textBuffer
      );
      textBuffer = updatedBuffer;
      textToSend = processedText;
      if (!textToSend) return;
    }

    callbacks.sendText(textToSend);
  });

  stream.on('end', () => {
    if (textBuffer) {
      callbacks.sendText(textBuffer);
    }
    callbacks.onStreamEnd?.();
    callbacks.close();
  });

  stream.on('error', (err: Error) => {
    options.onError?.(err);
    callbacks.close();
  });
}
