import { extractTextFromChunk } from '../src/utils/extract-text';

describe('Text Extraction', () => {
  test('extracts text from Vercel AI SDK format', () => {
    const chunk = { choices: [{ delta: { content: 'Vercel AI content' } }] };
    expect(extractTextFromChunk(chunk).text).toBe('Vercel AI content');
  });

  test('extracts text from OpenAI API format', () => {
    const chunk = { choices: [{ text: 'OpenAI content' }] };
    expect(extractTextFromChunk(chunk).text).toBe('OpenAI content');
  });

  test('extracts text from Anthropic API format variant 1', () => {
    const chunk = { delta: { text: 'Anthropic content' } };
    expect(extractTextFromChunk(chunk).text).toBe('Anthropic content');
  });

  test('extracts text from Anthropic API format variant 2', () => {
    const chunk = { content: [{ text: 'Anthropic content variant 2' }] };
    expect(extractTextFromChunk(chunk).text).toBe('Anthropic content variant 2');
  });

  test('handles simple string format', () => {
    expect(extractTextFromChunk('Simple string content').text).toBe('Simple string content');
  });

  test('decodes a Buffer chunk as UTF-8', () => {
    expect(extractTextFromChunk(Buffer.from('héllo')).text).toBe('héllo');
  });

  test('handles object with toString method', () => {
    const chunk = { toString: () => 'toString content' };
    expect(extractTextFromChunk(chunk).text).toBe('toString content');
  });

  test('returns empty text for null input', () => {
    expect(extractTextFromChunk(null)).toEqual({ text: '' });
  });

  test('returns empty text for undefined input', () => {
    expect(extractTextFromChunk(undefined)).toEqual({ text: '' });
  });

  test('returns empty text for object without supported format', () => {
    expect(extractTextFromChunk({ unsupported: 'format' })).toEqual({ text: '' });
  });

  test('reports a tool call as metadata alongside the text', () => {
    const call = { id: 'call_1', function: { name: 'f' } };
    const result = extractTextFromChunk({ choices: [{ delta: { content: 'hi', tool_calls: [call] } }] });
    expect(result.text).toBe('hi');
    expect(result.metadata).toEqual({ type: 'tool_call', id: 'call_1', content: call });
  });

  test('omits metadata when extractMetadata is false', () => {
    const chunk = { choices: [{ delta: { tool_calls: [{ id: 'call_1' }] } }] };
    expect(extractTextFromChunk(chunk, false).metadata).toBeUndefined();
  });
});
