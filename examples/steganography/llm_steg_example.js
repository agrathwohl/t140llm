/**
 * Example showing how to use LLM-generated steganography for RTP packets
 * 
 * This example uses OpenAI to generate a steganography algorithm and then
 * applies it to RTP packets carrying LLM-generated text.
 */

require('dotenv').config(); // Load environment variables from .env file
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { 
  processAIStreamToStegRtp, 
  createStegT140RtpTransport,
  StegTransport
} = require('../../dist');

// Only attempt to import OpenAI if API key is available
let OpenAI;
try {
  if (process.env.OPENAI_API_KEY) {
    OpenAI = require('openai').OpenAI;
  }
} catch (err) {
  console.warn('OpenAI SDK not available. Install with: npm install openai');
}

/**
 * Create a simple mock AI stream for demonstration purposes
 */
function createMockAIStream() {
  const emitter = new EventEmitter();
  
  // Simulate stream data events
  const messages = [
    "Hello, ",
    "this is ",
    "a test ",
    "of the ",
    "LLM-generated ",
    "steganography ",
    "feature."
  ];
  
  let index = 0;
  const interval = setInterval(() => {
    if (index < messages.length) {
      emitter.emit('data', messages[index]);
      index++;
    } else {
      emitter.emit('end');
      clearInterval(interval);
    }
  }, 500);
  
  return emitter;
}

/**
 * Load cover media samples from a directory
 * For demonstration, we'll generate random data as cover media
 */
function loadCoverMedia() {
  // In a real application, you would load actual cover media files
  // such as images, audio samples, etc.
  
  // Here we're just creating random buffers for demonstration
  const coverMedia = [];
  
  // Create 5 random buffers of 10KB each
  for (let i = 0; i < 5; i++) {
    const coverBuffer = Buffer.alloc(10240);
    // Fill with random data
    for (let j = 0; j < coverBuffer.length; j++) {
      coverBuffer[j] = Math.floor(Math.random() * 256);
    }
    coverMedia.push(coverBuffer);
  }
  
  return coverMedia;
}

/**
 * Custom transport that logs the original and steganographically modified packets
 */
class LoggingStegTransport {
  constructor() {
    this.packetCount = 0;
  }
  
  send(data, callback) {
    this.packetCount++;
    
    // Log packet info
    console.log(`Packet #${this.packetCount}: ${data.length} bytes`);
    
    // In a real application, you would send this data through your network interface
    // For demonstration, we just log it
    
    // Call the callback with no error
    if (callback) {
      callback();
    }
  }
  
  close() {
    console.log(`Transport closed. Stats: ${this.packetCount} packets sent`);
  }
}

/**
 * Run the example with LLM-generated algorithm
 */
async function runWithLLMAlgorithm() {
  if (!OpenAI || !process.env.OPENAI_API_KEY) {
    console.error('OpenAI API key not found. Set OPENAI_API_KEY in .env file');
    console.log('Falling back to default algorithm...');
    runWithDefaultAlgorithm();
    return;
  }
  
  try {
    console.log('=== LLM-Generated Steganography Example ===');
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // Load cover media
    const coverMedia = loadCoverMedia();
    console.log(`Loaded ${coverMedia.length} cover media samples`);
    
    // Generate steganography algorithm with GPT
    console.log('Generating steganography algorithm using LLM...');
    const prompt = `Create a steganography algorithm in JavaScript that hides binary data within cover media.
    
Requirements:
1. Create two functions: encode(data, cover) and decode(stegData)
2. The encode function should hide the 'data' Buffer within the 'cover' Buffer
3. The decode function should extract the hidden data from the 'stegData' Buffer
4. The algorithm should be resistant to basic statistical analysis
5. Use pure JavaScript with no external dependencies
6. The algorithm should store the data length somewhere in the cover media
7. Prefer robustness over capacity
8. Include comments explaining how your algorithm works

Example function signatures:
function encode(data, cover) { /* ... */ }
function decode(stegData) { /* ... */ }`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 2000,
    });
    
    const algorithm = completion.choices[0].message.content;
    console.log('Algorithm generated successfully!');
    
    // For demonstration, display the generated algorithm
    console.log('\nGenerated Algorithm:');
    console.log('-------------------');
    console.log(algorithm);
    console.log('-------------------\n');
    
    // Create a logging transport
    const innerTransport = new LoggingStegTransport();
    
    // Create a mock AI stream
    const stream = createMockAIStream();
    
    // Create a steganography transport
    const transport = processAIStreamToStegRtp(
      stream,
      "127.0.0.1", // Dummy address
      5004,        // Dummy port
      {
        customTransport: innerTransport,
        payloadType: 96,
        steganography: {
          enabled: true,
          encodeMode: 'llm',
          coverMedia,
          algorithm, // Use the LLM-generated algorithm
          seed: "example-random-seed"
        }
      }
    );
    
    // The transport will be closed automatically when the stream ends
    // Wait for stream to end
    await new Promise(resolve => {
      stream.on('end', resolve);
    });
    
    console.log('Example completed successfully!');
  } catch (err) {
    console.error('Error running LLM steganography example:', err);
    console.log('Falling back to default algorithm...');
    runWithDefaultAlgorithm();
  }
}

/**
 * Run the example with the default built-in algorithm
 */
function runWithDefaultAlgorithm() {
  console.log('=== Default Steganography Algorithm Example ===');
  
  // Load cover media
  const coverMedia = loadCoverMedia();
  console.log(`Loaded ${coverMedia.length} cover media samples`);
  
  // Create a logging transport
  const innerTransport = new LoggingStegTransport();
  
  // Create a mock AI stream
  const stream = createMockAIStream();
  
  // Create a steganography transport
  const transport = processAIStreamToStegRtp(
    stream,
    "127.0.0.1", // Dummy address
    5004,        // Dummy port
    {
      customTransport: innerTransport,
      payloadType: 96,
      steganography: {
        enabled: true,
        encodeMode: 'fixed', // Use the default algorithm
        coverMedia,
        seed: "example-random-seed"
      }
    }
  );
  
  console.log('Using built-in LSB steganography algorithm');
  console.log('Streaming LLM text with steganography...');
}

// Run the examples
if (require.main === module) {
  runWithLLMAlgorithm();
}

module.exports = {
  runWithLLMAlgorithm,
  runWithDefaultAlgorithm,
  createMockAIStream,
  loadCoverMedia,
  LoggingStegTransport
};