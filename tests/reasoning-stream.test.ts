import { EventEmitter } from 'events';
import { extractTextFromChunk } from '../src/utils/extract-text';
import { processAIStream } from '../src/processors/process-ai-stream';

describe('Reasoning stream extraction', () => {
  describe('extractTextFromChunk', () => {
    test('extracts Anthropic-style reasoning correctly', () => {
      const chunk = {
        delta: {
          text: 'The answer is 42.',
          reasoning: 'This is my reasoning process.'
        }
      };
      
      const result = extractTextFromChunk(chunk);
      
      // Check text extraction
      expect(result.text).toBe('The answer is 42.');
      
      // Check metadata extraction
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.type).toBe('reasoning');
      expect(result.metadata?.content).toBe('This is my reasoning process.');
    });
    
    test('extracts OpenAI-style reasoning correctly', () => {
      const chunk = {
        choices: [{
          delta: {
            content: 'The answer is 42.',
            reasoning: 'This is my OpenAI reasoning process.'
          }
        }]
      };
      
      const result = extractTextFromChunk(chunk);
      
      // Check text extraction
      expect(result.text).toBe('The answer is 42.');
      
      // Check metadata extraction
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.type).toBe('reasoning');
      expect(result.metadata?.content).toBe('This is my OpenAI reasoning process.');
    });
    
    test('extracts OpenAI message-format reasoning correctly', () => {
      const chunk = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'The answer is 42.',
            reasoning: 'This is my reasoning in message format.'
          }
        }]
      };
      
      const result = extractTextFromChunk(chunk);
      
      // Check metadata extraction
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.type).toBe('reasoning');
      expect(result.metadata?.content).toBe('This is my reasoning in message format.');
    });
  });
  
  // This section would normally test the processAIStream function,
  // but because it requires a WebSocket, we're focusing on just the extraction 
  // functionality which is the critical part of the reasoning support
  describe('Metadata handling for reasoning streams', () => {
    test('metadata callback properly extracts reasoning information', () => {
      // Create a test stream
      const mockStream = new EventEmitter();
      const metadataReceived: any[] = [];
      
      // Create a metadata handler
      const metadataHandler = (metadata: any) => {
        metadataReceived.push(metadata);
      };
      
      // Attach listener to the stream
      mockStream.on('metadata', metadataHandler);
      
      // Create a few sample chunks with reasoning
      const chunk1 = {
        delta: {
          text: 'First text chunk',
          reasoning: 'First reasoning chunk'
        }
      };
      
      const chunk2 = {
        delta: {
          text: 'Second text chunk',
          reasoning: 'Second reasoning chunk'
        }
      };
      
      // Extract and emit the metadata
      const result1 = extractTextFromChunk(chunk1);
      const result2 = extractTextFromChunk(chunk2);
      
      if (result1.metadata) mockStream.emit('metadata', result1.metadata);
      if (result2.metadata) mockStream.emit('metadata', result2.metadata);
      
      // Verify the metadata was correctly extracted and emitted
      expect(metadataReceived.length).toBe(2);
      expect(metadataReceived[0].type).toBe('reasoning');
      expect(metadataReceived[0].content).toBe('First reasoning chunk');
      expect(metadataReceived[1].type).toBe('reasoning');
      expect(metadataReceived[1].content).toBe('Second reasoning chunk');
    });
  });
});