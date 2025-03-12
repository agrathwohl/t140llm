/**
 * Example demonstrating how to process LLM metadata with t140llm direct socket mode
 */
const EventEmitter = require('events');
const { processAIStreamToDirectSocket } = require('../dist');

// Mock LLM stream with text and metadata for OpenAI-style tool calls
class MockOpenAIStream extends EventEmitter {
  constructor() {
    super();
    
    // Simulate an OpenAI stream with tool calls
    setTimeout(() => {
      // First chunk with text
      this.emit('data', {
        choices: [{ delta: { content: 'Let me check the current stock prices for you. ' } }]
      });
      
      // Second chunk with tool call
      setTimeout(() => {
        this.emit('data', {
          choices: [{ 
            delta: { 
              content: null,
              tool_calls: [
                {
                  id: "call_123456",
                  type: "function",
                  function: {
                    name: "get_stock_price",
                    arguments: JSON.stringify({
                      symbol: "AAPL",
                      market: "NASDAQ"
                    })
                  }
                }
              ] 
            } 
          }]
        });
        
        // Third chunk with text again
        setTimeout(() => {
          this.emit('data', {
            choices: [{ delta: { content: 'Apple Inc. (AAPL) is currently trading at $178.72, up 1.2%.' } }]
          });
          
          // Custom metadata packet
          setTimeout(() => {
            this.emit('data', {
              metadata: {
                source: 'financial_api',
                timestamp: Date.now(),
                confidence: 0.95
              }
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
const llmStream = new MockOpenAIStream();

// Process the stream with direct socket mode and metadata handling
const transport = processAIStreamToDirectSocket(llmStream, '/tmp/t140socket', {
  processBackspaces: true,
  handleMetadata: true,
  metadataCallback: handleMetadata,
  sendMetadataAsPackets: true // Send metadata as separate RTP packets
});

console.log('Processing LLM stream with metadata via direct socket mode...');
console.log('Connecting to socket at /tmp/t140socket');
console.log('Metadata will be logged to console and sent as RTP packets');