/**
 * Example demonstrating how to process LLM metadata (tool calls, tool results)
 * with t140llm
 */
const EventEmitter = require('events');
const { processAIStream } = require('../dist');

// Mock LLM stream with text and metadata
class MockLLMStream extends EventEmitter {
  constructor() {
    super();
    
    // We'll simulate a Claude stream with tool calls and tool results
    setTimeout(() => {
      // First chunk with text
      this.emit('data', {
        delta: { text: 'I need to check the weather for you. ' }
      });
      
      // Second chunk with tool call
      setTimeout(() => {
        this.emit('data', {
          delta: { 
            text: '',
            tool_use: {
              id: "tool_1",
              name: "get_weather",
              parameters: {
                location: "San Francisco",
                unit: "celsius"
              }
            }
          }
        });
        
        // Third chunk with tool result
        setTimeout(() => {
          this.emit('data', {
            type: 'tool_result',
            id: "tool_1",
            content: {
              temperature: 18,
              condition: "Sunny",
              humidity: 65
            }
          });
          
          // Final chunk with text
          setTimeout(() => {
            this.emit('data', {
              delta: { text: 'The weather in San Francisco is sunny, 18°C with 65% humidity.' }
            });
            
            // End the stream
            setTimeout(() => {
              this.emit('end');
            }, 500);
          }, 500);
        }, 500);
      }, 500);
    }, 500);
  }
}

// Create custom metadata handler
const handleMetadata = (metadata) => {
  console.log('===============');
  console.log('METADATA RECEIVED:');
  console.log(`Type: ${metadata.type}`);
  console.log('Content:', metadata.content);
  console.log('===============');
};

// Create the mock stream
const llmStream = new MockLLMStream();

// Process the stream with metadata handling enabled
processAIStream(llmStream, 'ws://localhost:3000', {
  processBackspaces: true,
  handleMetadata: true,
  metadataCallback: handleMetadata,
  sendMetadataOverWebsocket: true
});

console.log('Processing LLM stream with metadata...');
console.log('Text will be sent to WebSocket server on port 3000');
console.log('Metadata will be logged to console and sent over WebSocket');