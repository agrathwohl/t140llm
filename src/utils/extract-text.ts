import { LLMMetadata } from '../interfaces';

/**
 * Result of text extraction: the text to transmit plus any metadata found in the chunk.
 */
export interface ExtractedContent {
  text: string;
  metadata?: LLMMetadata;
}

/**
 * Metadata detection. Later matches override earlier ones, so a chunk that
 * carries both a tool call and reasoning reports the reasoning.
 */
function detectMetadata(chunk: any): LLMMetadata | undefined {
  let metadata: LLMMetadata | undefined;

  const toolCalls = [
    chunk?.choices?.[0]?.delta?.tool_calls?.[0], // OpenAI, Vercel AI SDK
    chunk?.delta?.tool_use,                       // Anthropic
    chunk?.delta?.tool_calls?.[0],                // Mistral
    chunk?.tool_calls?.[0],                       // Cohere, Ollama
  ];
  for (const call of toolCalls) {
    if (call) metadata = { type: 'tool_call', id: call.id || undefined, content: call };
  }

  const functionCall = chunk?.candidates?.[0]?.content?.parts?.[0]?.functionCall; // Gemini
  if (functionCall) {
    metadata = { type: 'tool_call', id: functionCall.name || undefined, content: functionCall };
  }

  if (chunk?.type === 'tool_result' || chunk?.delta?.type === 'tool_result') {
    metadata = {
      type: 'tool_result',
      id: chunk.id || chunk.delta?.id || undefined,
      content: chunk.delta || chunk,
    };
  }

  const reasoning = chunk?.choices?.[0]?.delta?.reasoning || chunk?.delta?.reasoning;
  if (reasoning) metadata = { type: 'reasoning', content: reasoning };

  const message = chunk?.choices?.[0]?.message;
  if (message?.role === 'assistant' && message.reasoning) {
    metadata = { type: 'reasoning', content: message.reasoning };
  }

  const custom = chunk?.metadata || chunk?.delta?.metadata;
  if (custom) metadata = { type: 'custom', content: custom };

  return metadata;
}

/** Text fields of the stream chunk shapes we accept, in precedence order. */
const TEXT_SOURCES: ((chunk: any) => unknown)[] = [
  (c) => c?.choices?.[0]?.delta?.content,               // OpenAI chat, Vercel AI SDK
  (c) => c?.choices?.[0]?.text,                         // OpenAI completions
  (c) => c?.delta?.text,                                // Anthropic
  (c) => c?.delta?.content,                             // Mistral
  (c) => c?.text,                                       // Cohere
  (c) => c?.response,                                   // Ollama
  (c) => c?.candidates?.[0]?.content?.parts?.[0]?.text, // Gemini
  (c) => c?.content?.[0]?.text,                         // Anthropic message
];

function extractText(chunk: any): string {
  if (typeof chunk === 'string') return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString('utf-8');

  for (const read of TEXT_SOURCES) {
    const value = read(chunk);
    if (value !== undefined) return typeof value === 'string' ? value : '';
  }

  // Objects with their own toString are text-like. Plain SDK event objects
  // (message_start, content_block_stop, ...) are not and yield no text.
  if (
    chunk &&
    typeof chunk.toString === 'function' &&
    chunk.toString !== Object.prototype.toString
  ) {
    return chunk.toString();
  }
  return '';
}

/**
 * Extract the text to transmit from an LLM stream chunk, and detect metadata
 * such as tool calls, tool results, and reasoning.
 *
 * @param chunk A chunk from any supported SDK stream, a string, or a Buffer
 * @param extractMetadata Set false to skip metadata detection
 */
export function extractTextFromChunk(
  chunk: any,
  extractMetadata: boolean = true
): ExtractedContent {
  const result: ExtractedContent = { text: extractText(chunk) };
  if (extractMetadata) {
    const metadata = detectMetadata(chunk);
    if (metadata) result.metadata = metadata;
  }
  return result;
}
