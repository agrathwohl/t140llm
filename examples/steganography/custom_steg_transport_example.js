/**
 * Example showing how to create and use a custom steganography transport
 *
 * This example demonstrates how to extend StegTransport with custom
 * tracking and logging functionality using llm-steg's LSB algorithm.
 */

const { EventEmitter } = require('events');
const {
  StegTransport,
  createStegT140RtpTransport,
  processAIStreamToStegRtp
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
    "custom ",
    "steganography ",
    "transport."
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
 * Generate some random cover media for demonstration purposes
 */
function generateCoverMedia(count = 5, size = 10240) {
  const coverMedia = [];

  for (let i = 0; i < count; i++) {
    const buffer = Buffer.alloc(size);
    // Fill with random data
    for (let j = 0; j < buffer.length; j++) {
      buffer[j] = Math.floor(Math.random() * 256);
    }
    coverMedia.push(buffer);
  }

  return coverMedia;
}

/**
 * Custom inner transport for demonstration
 */
class LoggingTransport {
  constructor() {
    this.packetCount = 0;
    this.originalPackets = [];
    this.stegoPackets = [];
  }

  send(data, callback) {
    this.packetCount++;
    this.stegoPackets.push(Buffer.from(data)); // Save a copy

    // Log some information about the packet
    console.log(`Packet #${this.packetCount}: ${data.length} bytes`);

    // For demo purposes, also log a hex sample of the data
    const hexSample = data.slice(0, 16).toString('hex').match(/.{1,2}/g).join(' ');
    console.log(`First 16 bytes: ${hexSample}`);

    // In a real application, you would send this packet over the network

    if (callback) callback();
  }

  close() {
    console.log(`Transport closed. ${this.packetCount} packets sent.`);
  }

  // Additional method to store the original packet before steganographic encoding
  storeOriginal(data) {
    this.originalPackets.push(Buffer.from(data));
  }
}

/**
 * Custom steganography transport with advanced tracking features
 * Extends StegTransport to add packet tracking and bit change analysis
 */
class CustomStegTransport extends StegTransport {
  constructor(innerTransport, config) {
    super(innerTransport, config);

    // Track original packets for analysis
    this.originalPackets = [];

    // If inner transport is LoggingTransport, store reference
    if (innerTransport instanceof LoggingTransport) {
      this.loggingTransport = innerTransport;
    }
  }

  // Override the send method to track original packets
  send(data, callback) {
    // Store the original packet
    this.originalPackets.push(Buffer.from(data));

    // If we have a logging transport, also store it there
    if (this.loggingTransport) {
      this.loggingTransport.storeOriginal(data);
    }

    // Call the parent send method to apply steganography and send
    super.send(data, callback);
  }

  // Override the encode method to add custom logging
  encode(data, cover) {
    console.log(`Encoding ${data.length} bytes into ${cover.length} bytes cover`);

    // Call the parent encode method (uses llm-steg's LSBAlgorithm)
    const encoded = super.encode(data, cover);

    // Additional statistics
    const bitChanges = this.countBitChanges(cover, encoded);
    console.log(`Modified ${bitChanges} bits (${(bitChanges * 100 / (encoded.length * 8)).toFixed(2)}% of cover)`);

    return encoded;
  }

  // Helper method to count bit changes between original and stego media
  countBitChanges(original, modified) {
    let count = 0;
    const minLength = Math.min(original.length, modified.length);

    for (let i = 0; i < minLength; i++) {
      const xorValue = original[i] ^ modified[i];

      // Count set bits in the XOR result (Hamming weight)
      for (let bit = 0; bit < 8; bit++) {
        if ((xorValue >> bit) & 1) {
          count++;
        }
      }
    }

    return count;
  }

  // Get statistics about the steganography operations
  getStats() {
    return {
      packetsProcessed: this.originalPackets.length,
      totalBytesHidden: this.originalPackets.reduce((sum, p) => sum + p.length, 0)
    };
  }
}

/**
 * Run the example with the custom steganography transport
 */
function runExample() {
  console.log('=== Custom Steganography Transport Example ===\n');

  // Generate some cover media
  const coverMedia = generateCoverMedia();
  console.log(`Generated ${coverMedia.length} cover media samples`);

  // Create the inner transport
  const innerTransport = new LoggingTransport();

  // Create a mock AI stream
  const stream = createMockAIStream();

  // Create the custom steganography transport config
  // Note: Uses llm-steg's LSB algorithm internally
  const customStegConfig = {
    enabled: true,
    encodeMode: 'fixed',
    coverMedia,
    seed: 'custom-example-seed'
  };

  // Create a custom steg transport
  const stegTransport = new CustomStegTransport(innerTransport, customStegConfig);

  // Create the T140RtpTransport using the custom steg transport
  const transport = createStegT140RtpTransport(
    '127.0.0.1', // Dummy address
    5004,        // Dummy port
    {
      payloadType: 96,
      customTransport: stegTransport,
      ssrc: 12345
    }
  );

  // Attach the AI stream
  const { processAIStreamToRtp } = require('../../dist');
  processAIStreamToRtp(stream, '127.0.0.1', 5004, {
    customTransport: transport,
    payloadType: 96,
    ssrc: 12345
  });

  console.log('Streaming LLM text with custom steganography transport...\n');

  // On stream end, print stats
  stream.on('end', () => {
    console.log('\n--- Statistics ---');
    const stats = stegTransport.getStats();
    console.log(`Packets processed: ${stats.packetsProcessed}`);
    console.log(`Total bytes hidden: ${stats.totalBytesHidden}`);
    console.log('Example completed successfully!');
  });
}

/**
 * Demonstrate the bit change analysis
 */
function demonstrateBitAnalysis() {
  console.log('=== Bit Change Analysis Demonstration ===\n');

  const coverMedia = generateCoverMedia(1, 1024);

  // Create a mock transport
  const mockTransport = {
    send: (data, callback) => { if (callback) callback(); },
    close: () => {}
  };

  // Create custom steg transport
  const stegTransport = new CustomStegTransport(mockTransport, {
    enabled: true,
    encodeMode: 'fixed',
    coverMedia
  });

  // Test with different message sizes
  const testMessages = [
    'Hi',
    'Hello World',
    'This is a longer test message for steganography!'
  ];

  console.log('Cover media size:', coverMedia[0].length, 'bytes');
  console.log('');

  for (const msg of testMessages) {
    console.log(`Message: "${msg}" (${msg.length} bytes)`);
    const data = Buffer.from(msg);
    const cover = Buffer.from(coverMedia[0]); // Fresh copy
    stegTransport.encode(data, cover);
    console.log('');
  }
}

// Run the example
if (require.main === module) {
  demonstrateBitAnalysis();
  console.log('='.repeat(50) + '\n');
  runExample();
}

module.exports = {
  runExample,
  createMockAIStream,
  generateCoverMedia,
  LoggingTransport,
  CustomStegTransport,
  demonstrateBitAnalysis
};
