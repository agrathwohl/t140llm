/**
 * Example showing how to create and use a custom steganography transport
 * 
 * This example demonstrates how to implement a custom steganography algorithm
 * and use it with the t140llm library.
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
 * Custom steganography transport with advanced features
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
  
  // Override the encode method to add custom logic
  encode(data, cover) {
    console.log(`Encoding ${data.length} bytes into ${cover.length} bytes cover`);
    
    // Call the parent encode method to apply the steganography algorithm
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
}

/**
 * Run the example with the custom steganography transport
 */
function runExample() {
  console.log('=== Custom Steganography Transport Example ===');
  
  // Generate some cover media
  const coverMedia = generateCoverMedia();
  console.log(`Generated ${coverMedia.length} cover media samples`);
  
  // Create a custom algorithm
  const customAlgorithm = `
// Frequency domain steganography simulation (simplified for demo)
// In a real implementation, this would use FFT for actual frequency domain operations

function encode(data, cover) {
  // Ensure cover is large enough
  if (cover.length < data.length * 10) {
    throw new Error('Cover media too small for data payload');
  }
  
  // Create a copy of the cover
  const result = Buffer.from(cover);
  
  // Store data length in first 4 bytes using "odd parity"
  for (let i = 0; i < 32; i++) {
    const bytePos = i % 4;
    const bitPos = Math.floor(i / 4);
    
    // Set the target bit to odd parity if the corresponding data bit is 1
    // or to even parity if it's 0
    const lengthBit = (data.length >> i) & 1;
    const coverByte = result[bytePos * 8 + bitPos];
    const parity = countBits(coverByte) % 2; // Current parity
    
    if ((parity === 0 && lengthBit === 1) || (parity === 1 && lengthBit === 0)) {
      // Flip the least significant bit to change parity
      result[bytePos * 8 + bitPos] ^= 1;
    }
  }
  
  // Embed data using a "pattern-based" approach rather than simple LSB
  // Each bit modifies a small pattern in the cover rather than a single bit
  const patternSize = 4; // 4 bytes per bit
  const patternCount = Math.min(data.length * 8, Math.floor((cover.length - 32) / patternSize));
  
  for (let i = 0; i < patternCount; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const bit = (data[byteIndex] >> bitIndex) & 1;
    
    // Calculate position in cover
    const coverPos = 32 + (i * patternSize);
    
    // Apply pattern change
    if (bit === 1) {
      // For a '1' bit, make the pattern's gradient ascending
      for (let j = 0; j < patternSize - 1; j++) {
        if (result[coverPos + j] >= result[coverPos + j + 1]) {
          // Ensure ascending pattern
          result[coverPos + j + 1] = result[coverPos + j] + 1;
        }
      }
    } else {
      // For a '0' bit, make the pattern's gradient descending
      for (let j = 0; j < patternSize - 1; j++) {
        if (result[coverPos + j] <= result[coverPos + j + 1]) {
          // Ensure descending pattern
          result[coverPos + j + 1] = Math.max(0, result[coverPos + j] - 1);
        }
      }
    }
  }
  
  return result;
}

function decode(stegData) {
  // Extract data length from first 4 bytes using parity
  let dataLength = 0;
  for (let i = 0; i < 32; i++) {
    const bytePos = i % 4;
    const bitPos = Math.floor(i / 4);
    
    // Get parity of the byte
    const coverByte = stegData[bytePos * 8 + bitPos];
    const parity = countBits(coverByte) % 2;
    
    // If parity is odd, the bit is 1
    if (parity === 1) {
      dataLength |= (1 << i);
    }
  }
  
  // Validate data length
  if (dataLength <= 0 || dataLength > (stegData.length - 32) / 32) {
    throw new Error('Invalid data length in steganographic content');
  }
  
  // Create result buffer
  const result = Buffer.alloc(dataLength);
  
  // Extract data using pattern detection
  const patternSize = 4;
  const patternCount = Math.min(dataLength * 8, Math.floor((stegData.length - 32) / patternSize));
  
  for (let i = 0; i < patternCount; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    
    // Calculate position in stego data
    const stegPos = 32 + (i * patternSize);
    
    // Detect pattern
    let ascending = true;
    for (let j = 0; j < patternSize - 1; j++) {
      if (stegData[stegPos + j] >= stegData[stegPos + j + 1]) {
        ascending = false;
        break;
      }
    }
    
    // If pattern is ascending, the bit is 1
    if (ascending) {
      result[byteIndex] |= (1 << bitIndex);
    }
  }
  
  return result;
}

// Helper function to count the number of set bits in a byte
function countBits(byte) {
  let count = 0;
  for (let i = 0; i < 8; i++) {
    if ((byte >> i) & 1) {
      count++;
    }
  }
  return count;
}`;
  
  // Create the inner transport
  const innerTransport = new LoggingTransport();
  
  // Create a mock AI stream
  const stream = createMockAIStream();
  
  // Create the custom steganography transport
  const customStegConfig = {
    enabled: true,
    encodeMode: 'fixed',
    algorithm: customAlgorithm,
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
  
  console.log('Streaming LLM text with custom steganography...');
}

// Run the example
if (require.main === module) {
  runExample();
}

module.exports = {
  runExample,
  createMockAIStream,
  generateCoverMedia,
  LoggingTransport,
  CustomStegTransport
};