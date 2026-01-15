/**
 * Example showing how to use steganography for RTP packets
 *
 * This example demonstrates the llm-steg integration for hiding
 * RTP packets within cover media using LSB steganography.
 */

require('dotenv').config(); // Load environment variables from .env file
const { EventEmitter } = require('events');
const {
  processAIStreamToStegRtp,
  createStegT140RtpTransport,
  StegTransport
} = require('../../dist');

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
    "llm-steg ",
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
 * Run the example with LSB steganography (powered by llm-steg)
 */
function runWithLSBAlgorithm() {
  console.log('=== LSB Steganography Example (llm-steg) ===');

  // Load cover media
  const coverMedia = loadCoverMedia();
  console.log(`Loaded ${coverMedia.length} cover media samples`);

  // Create a logging transport
  const innerTransport = new LoggingStegTransport();

  // Create a mock AI stream
  const stream = createMockAIStream();

  // Create a steganography transport using llm-steg's LSB algorithm
  const transport = processAIStreamToStegRtp(
    stream,
    "127.0.0.1", // Dummy address
    5004,        // Dummy port
    {
      customTransport: innerTransport,
      payloadType: 96,
      steganography: {
        enabled: true,
        encodeMode: 'fixed', // Uses llm-steg LSB algorithm
        coverMedia,
        seed: "example-random-seed"
      }
    }
  );

  console.log('Using llm-steg LSB steganography algorithm');
  console.log('Streaming LLM text with steganography...\n');

  // Wait for stream to end
  stream.on('end', () => {
    console.log('\nExample completed successfully!');
  });
}

/**
 * Demonstrate encode/decode directly
 */
function demonstrateEncodeDecode() {
  console.log('=== Direct Encode/Decode Demonstration ===\n');

  const coverMedia = loadCoverMedia();

  // Create a mock transport
  const mockTransport = {
    send: (data, callback) => { if (callback) callback(); },
    close: () => {}
  };

  // Create steganography transport
  const stegTransport = new StegTransport(mockTransport, {
    enabled: true,
    encodeMode: 'fixed',
    coverMedia
  });

  // Test data
  const originalMessage = 'Secret message hidden in cover media!';
  const originalBuffer = Buffer.from(originalMessage);

  console.log('Original message:', originalMessage);
  console.log('Original size:', originalBuffer.length, 'bytes');

  // Encode
  const cover = coverMedia[0];
  const encoded = stegTransport.encode(originalBuffer, cover);
  console.log('Encoded size:', encoded.length, 'bytes');
  console.log('Expansion ratio:', (encoded.length / originalBuffer.length).toFixed(1) + 'x');

  // Decode
  const decoded = stegTransport.decode(encoded);
  const decodedMessage = decoded.toString();

  console.log('Decoded message:', decodedMessage);
  console.log('Match:', originalMessage === decodedMessage ? '✓ SUCCESS' : '✗ FAILED');
}

// Run the examples
if (require.main === module) {
  demonstrateEncodeDecode();
  console.log('\n' + '='.repeat(50) + '\n');
  runWithLSBAlgorithm();
}

module.exports = {
  runWithLSBAlgorithm,
  createMockAIStream,
  loadCoverMedia,
  LoggingStegTransport,
  demonstrateEncodeDecode
};
