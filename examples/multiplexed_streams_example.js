const EventEmitter = require('events');
const t140llm = require('../dist'); // Adjust path as needed

// Create a simple TextDataStream implementation
class MockLLMStream extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
  }

  simulateOutput(text, delay = 50) {
    const words = text.split(' ');
    let i = 0;

    const interval = setInterval(() => {
      if (i < words.length) {
        this.emit('data', { text: words[i] + ' ' });
        i++;
      } else {
        clearInterval(interval);
        this.emit('end');
      }
    }, delay);
  }

  simulateMetadata(metadata) {
    this.emit('data', { metadata });
  }
}

// Example usage
async function main() {
  // Create multiple mock LLM streams
  const stream1 = new MockLLMStream('llm1');
  const stream2 = new MockLLMStream('llm2');
  const stream3 = new MockLLMStream('llm3');

  // Create a map of streams
  const streams = new Map();
  streams.set('llm1', stream1);
  streams.set('llm2', stream2);
  // We'll add stream3 later to demonstrate dynamic addition

  // Create the multiplexer
  const multiplexer = t140llm.processAIStreamsToMultiplexedRtp(
    streams,
    '127.0.0.1',  // Send to localhost
    5004,         // RTP port
    {
      multiplexEnabled: true,
      useCsrcForStreamId: true, // Use CSRC field for identification
      charRateLimit: 50,        // Higher rate limit for multiple streams
      fecEnabled: true,         // Enable FEC for reliability
      redEnabled: true,         // Enable redundancy
    }
  );

  // Set up event handlers
  multiplexer.on('error', (err) => {
    console.error('Multiplexer error:', err);
  });

  multiplexer.on('streamError', ({ streamId, error }) => {
    console.error(`Error in stream ${streamId}:`, error);
  });

  multiplexer.on('metadata', (metadata) => {
    console.log(`Metadata from stream ${metadata.streamId}:`, metadata);
  });

  // Start sending data from streams
  console.log('Starting simulation with streams 1 and 2...');
  stream1.simulateOutput('This is the first LLM stream sending some text to demonstrate multiplexing.', 150);
  
  // Wait 1 second before starting stream 2
  setTimeout(() => {
    stream2.simulateOutput('The second LLM stream will now interleave with the first one. This shows how multiple streams can be multiplexed.', 200);
  }, 1000);

  // After 3 seconds, add a third stream dynamically
  setTimeout(() => {
    console.log('Adding stream 3 dynamically...');
    t140llm.addAIStreamToMultiplexer(
      multiplexer,
      'llm3',
      stream3,
      {
        // Stream-specific options can be set here
        // These will override the global multiplexer options
      }
    );
    
    // Send some data on the new stream
    stream3.simulateOutput('This is stream 3, which was added dynamically after the multiplexer was created.', 100);
    
    // Also send some metadata
    stream3.simulateMetadata({
      type: 'custom',
      content: { message: 'This is metadata from stream 3' }
    });
  }, 3000);

  // Allow the example to run for 15 seconds then clean up
  setTimeout(() => {
    console.log('Closing multiplexer...');
    multiplexer.close();
    console.log('Example completed.');
    process.exit(0);
  }, 15000);
}

main().catch(err => {
  console.error('Error in example:', err);
  process.exit(1);
});