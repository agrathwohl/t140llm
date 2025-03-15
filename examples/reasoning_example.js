/**
 * Example demonstrating how to process LLM reasoning streams with t140llm
 * 
 * Many modern LLMs can provide their reasoning process as separate metadata
 * alongside their generated text responses. This example shows how to:
 * 
 * 1. Process and extract reasoning streams from LLMs (OpenAI and Anthropic)
 * 2. Handle the reasoning metadata separately from the generated text
 * 3. Send both to clients with appropriate separation
 */
const EventEmitter = require('events');
const { processAIStream } = require('../dist');

// Mock LLM stream with text and reasoning metadata
class MockLLMReasoningStream extends EventEmitter {
  constructor() {
    super();
    
    // We'll simulate both Anthropic and OpenAI style reasoning streams
    setTimeout(() => {
      // First chunk with text - Anthropic style
      this.emit('data', {
        delta: { 
          text: 'The answer is 42.',
          reasoning: 'I need to calculate the answer to the ultimate question of life, the universe, and everything.'
        }
      });
      
      // Second chunk with reasoning continuation - Anthropic style
      setTimeout(() => {
        this.emit('data', {
          delta: { 
            text: ' This is based on', 
            reasoning: 'According to Douglas Adams\' book "The Hitchhiker\'s Guide to the Galaxy", the supercomputer Deep Thought calculated this answer.'
          }
        });
        
        // Third chunk with OpenAI style reasoning
        setTimeout(() => {
          this.emit('data', {
            choices: [{
              delta: { 
                content: ' deep analysis.', 
                reasoning: 'The number 42 appears in many contexts and has cultural significance beyond the book.'
              }
            }]
          });
          
          // End the stream
          setTimeout(() => {
            this.emit('end');
          }, 500);
        }, 500);
      }, 500);
    }, 500);
  }
}

// Create custom reasoning metadata handler
const handleReasoningMetadata = (metadata) => {
  console.log('===============');
  console.log('REASONING RECEIVED:');
  console.log('Content:', metadata.content);
  console.log('===============');
};

// Create the mock stream
const llmStream = new MockLLMReasoningStream();

// Process the stream with reasoning metadata handling enabled
processAIStream(llmStream, 'ws://localhost:3000', {
  processBackspaces: true,
  handleMetadata: true,
  metadataCallback: handleReasoningMetadata,
  sendMetadataOverWebsocket: true
});

console.log('Processing LLM stream with reasoning metadata...');
console.log('Text will be sent to WebSocket server on port 3000');
console.log('Reasoning metadata will be logged to console and sent over WebSocket');