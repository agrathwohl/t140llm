import { LLMMetadata } from '../interfaces';

/**
 * Result interface for text extraction containing both text and metadata
 */
export interface ExtractedContent {
  text: string;
  metadata?: LLMMetadata | null;
}

/**
 * Helper function to extract text content from various stream data formats
 * and detect any metadata like tool calls
 */
export function extractTextFromChunk(chunk: any): ExtractedContent {
  const result: ExtractedContent = { text: '' };

  // Extract metadata from OpenAI tool calls
  if (chunk?.choices?.[0]?.delta?.tool_calls) {
    const toolCall = chunk.choices[0].delta.tool_calls[0];
    result.metadata = {
      type: 'tool_call',
      id: toolCall.id || undefined,
      content: toolCall,
    };
  }

  // Extract metadata from Anthropic tool calls (Claude 3.5+)
  if (chunk?.delta?.tool_use) {
    result.metadata = {
      type: 'tool_call',
      id: chunk.delta.tool_use.id || undefined,
      content: chunk.delta.tool_use,
    };
  }

  // Extract metadata from Mistral AI tool calls (similar to OpenAI format)
  if (chunk?.delta?.tool_calls) {
    const toolCall = chunk.delta.tool_calls[0];
    result.metadata = {
      type: 'tool_call',
      id: toolCall.id || undefined,
      content: toolCall,
    };
  }

  // Extract metadata from Cohere tool calls
  if (chunk?.tool_calls) {
    const toolCall = chunk.tool_calls[0];
    result.metadata = {
      type: 'tool_call',
      id: toolCall.id || undefined,
      content: toolCall,
    };
  }

  // Extract metadata from Anthropic tool results (tool_results)
  if (chunk?.type === 'tool_result' || chunk?.delta?.type === 'tool_result') {
    result.metadata = {
      type: 'tool_result',
      id: (chunk.id || chunk.delta?.id) || undefined,
      content: chunk.delta || chunk,
    };
  }

  // Extract reasoning from LLM responses
  if (chunk?.choices?.[0]?.delta?.reasoning || chunk?.delta?.reasoning) {
    result.metadata = {
      type: 'reasoning',
      content: chunk?.choices?.[0]?.delta?.reasoning || chunk?.delta?.reasoning,
    };
  }

  // Extract reasoning for OpenAI specifically in message format
  if (chunk?.choices?.[0]?.message?.role === 'assistant' &&
      chunk?.choices?.[0]?.message?.reasoning) {
    result.metadata = {
      type: 'reasoning',
      content: chunk.choices[0].message.reasoning,
    };
  }

  // Extract custom metadata if present
  if (chunk?.metadata || chunk?.delta?.metadata) {
    result.metadata = {
      type: 'custom',
      content: chunk.metadata || chunk.delta?.metadata,
    };
  }

  // Handle Vercel AI SDK format
  if (chunk?.choices?.[0]?.delta?.content !== undefined) {
    result.text = chunk.choices[0].delta.content;
    return result;
  }

  // Handle OpenAI API format
  if (chunk?.choices?.[0]?.text !== undefined) {
    result.text = chunk.choices[0].text;
    return result;
  }

  // Handle Anthropic API format
  if (chunk?.delta?.text !== undefined) {
    result.text = chunk.delta.text;
    return result;
  }

  // Handle Mistral AI format (similar to OpenAI but with slight differences)
  if (chunk?.delta?.content !== undefined) {
    result.text = chunk.delta.content;
    return result;
  }

  // Handle Cohere format
  if (chunk?.text !== undefined) {
    result.text = chunk.text;
    return result;
  }

  // Handle Ollama format
  if (chunk?.response !== undefined) {
    result.text = chunk.response;
    return result;
  }

  if (chunk?.content?.[0]?.text !== undefined) {
    result.text = chunk.content[0].text;
    return result;
  }

  // Handle simple string format
  if (typeof chunk === 'string') {
    result.text = chunk;
    return result;
  }

  // Handle other object with toString
  if (chunk && typeof chunk.toString === 'function') {
    result.text = chunk.toString();
    return result;
  }

  return result;
}
