/**
 * Example of using t140llm with Google's Gemini
 * 
 * This example demonstrates using t140llm to process AI streams
 * from Google's Generative AI API
 */

const { processAIStream } = require('../dist');
const { EventEmitter } = require('events');

// For Gemini (requires @google/generative-ai package)
async function streamFromGemini() {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  
  // Initialize the Gemini API with your API key
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

  // Create a chat session
  const chat = model.startChat();
  
  // Create an event emitter to simulate a stream
  const stream = new EventEmitter();
  
  // Get a streaming response
  const result = await chat.sendMessageStream('Write a haiku about programming');
  
  // Process the stream
  const processChunks = async () => {
    try {
      for await (const chunk of result.stream) {
        // Emit each chunk
        stream.emit('data', chunk);
      }
      // Signal the end of the stream
      stream.emit('end');
    } catch (error) {
      stream.emit('error', error);
    }
  };
  
  processChunks();
  return stream;
}

async function main() {
  try {
    console.log('Streaming from Google Gemini...');
    const stream = await streamFromGemini();
    
    // Process the stream with t140llm
    processAIStream(stream, 'ws://localhost:8765', {
      processBackspaces: true,
      handleMetadata: true,
      metadataCallback: (metadata) => {
        console.log('Received metadata:', metadata.type);
      },
    });
    
    console.log('Streaming from Gemini started');
  } catch (error) {
    console.error('Error:', error);
  }
}

// Export the streamFromGemini function to be used in other examples
module.exports = { streamFromGemini };

// Run the example if this script is called directly
if (require.main === module) {
  main();
}
