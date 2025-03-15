/**
 * Example demonstrating how to process LLM reasoning streams with t140llm
 * in direct socket mode.
 * 
 * This example shows how to:
 * 1. Process reasoning streams using Unix domain sockets for direct communication
 * 2. Use separate sockets for text and reasoning to keep them separated
 */
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { processAIStreamToDirectSocket } = require('../dist');

// Create temporary socket paths
const tmpDir = os.tmpdir();
const textSocketPath = path.join(tmpDir, 'text-stream.sock');
const reasoningSocketPath = path.join(tmpDir, 'reasoning-stream.sock');

// Clean up any existing sockets
if (fs.existsSync(textSocketPath)) fs.unlinkSync(textSocketPath);
if (fs.existsSync(reasoningSocketPath)) fs.unlinkSync(reasoningSocketPath);

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

// Create a separate socket for reasoning data
const reasoningSocket = processAIStreamToDirectSocket(
  new EventEmitter(), // Empty stream to initialize socket
  reasoningSocketPath
);

// Create custom reasoning metadata handler that sends to separate socket
const handleReasoningMetadata = (metadata) => {
  console.log('Reasoning received - sending to socket:', reasoningSocketPath);
  if (metadata.type === 'reasoning') {
    reasoningSocket.write(JSON.stringify({
      type: 'reasoning',
      content: metadata.content
    }) + '\n');
  }
};

// Create the mock stream
const llmStream = new MockLLMReasoningStream();

// Process the stream with reasoning metadata handling enabled
const textSocket = processAIStreamToDirectSocket(
  llmStream,
  textSocketPath, 
  {
    handleMetadata: true,
    metadataCallback: handleReasoningMetadata
  }
);

// Set up cleanup for both sockets
process.on('SIGINT', () => {
  console.log('Cleaning up sockets...');
  textSocket.end();
  reasoningSocket.end();
  
  // Remove socket files
  setTimeout(() => {
    if (fs.existsSync(textSocketPath)) fs.unlinkSync(textSocketPath);
    if (fs.existsSync(reasoningSocketPath)) fs.unlinkSync(reasoningSocketPath);
    process.exit(0);
  }, 100);
});

console.log('Processing LLM stream with reasoning metadata...');
console.log(`Text socket: ${textSocketPath}`);
console.log(`Reasoning socket: ${reasoningSocketPath}`);
console.log('Press Ctrl+C to terminate');

// To read from these sockets, you can use:
// nc -U <socket_path>
// or in another Node.js process:
// const net = require('net');
// const client = net.createConnection({ path: '<socket_path>' });
// client.on('data', (data) => console.log(data.toString()));