/**
 * Helper function to extract text content from various stream data formats
 */
export function extractTextFromChunk(chunk: any): string {
  // Handle Vercel AI SDK format
  if (chunk?.choices?.[0]?.delta?.content !== undefined) {
    return chunk.choices[0].delta.content;
  }
  // Handle OpenAI API format
  if (chunk?.choices?.[0]?.text !== undefined) {
    return chunk.choices[0].text;
  }
  // Handle Anthropic API format
  if (chunk?.delta?.text !== undefined) {
    return chunk.delta.text;
  }
  if (chunk?.content?.[0]?.text !== undefined) {
    return chunk.content[0].text;
  }
  // Handle simple string format
  if (typeof chunk === 'string') {
    return chunk;
  }
  // Handle other object with toString
  if (chunk && typeof chunk.toString === 'function') {
    return chunk.toString();
  }

  return '';
}
