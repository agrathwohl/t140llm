// Import the extractTextFromChunk function directly (now exported for testing)
import { extractTextFromChunk } from '../src';

describe('Text Extraction', () => {
  test('extracts text from Vercel AI SDK format', () => {
    const chunk = {
      choices: [{ delta: { content: 'Vercel AI content' } }]
    };
    expect(extractTextFromChunk(chunk)).toBe('Vercel AI content');
  });

  test('extracts text from OpenAI API format', () => {
    const chunk = {
      choices: [{ text: 'OpenAI content' }]
    };
    expect(extractTextFromChunk(chunk)).toBe('OpenAI content');
  });

  test('extracts text from Anthropic API format variant 1', () => {
    const chunk = {
      delta: { text: 'Anthropic content' }
    };
    expect(extractTextFromChunk(chunk)).toBe('Anthropic content');
  });

  test('extracts text from Anthropic API format variant 2', () => {
    const chunk = {
      content: [{ text: 'Anthropic content variant 2' }]
    };
    expect(extractTextFromChunk(chunk)).toBe('Anthropic content variant 2');
  });

  test('handles simple string format', () => {
    const chunk = 'Simple string content';
    expect(extractTextFromChunk(chunk)).toBe('Simple string content');
  });

  test('handles object with toString method', () => {
    const chunk = {
      toString: () => 'toString content'
    };
    expect(extractTextFromChunk(chunk)).toBe('toString content');
  });

  test('returns empty string for null input', () => {
    expect(extractTextFromChunk(null)).toBe('');
  });

  test('returns empty string for undefined input', () => {
    expect(extractTextFromChunk(undefined)).toBe('');
  });

  test('returns empty string for object without supported format', () => {
    const chunk = { unsupported: 'format' };
    expect(extractTextFromChunk(chunk)).toBe('');
  });
});