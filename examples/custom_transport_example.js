/**
 * Example showing how to use a custom transport with T140RtpTransport
 * 
 * This example creates a custom transport that logs packets and can be
 * used with the T140RtpTransport class directly or with the process functions.
 */

const { processAIStreamToRtp, processAIStreamToSrtp, createSrtpKeysFromPassphrase, T140RtpTransport } = require('../dist');
const { EventEmitter } = require('events');

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
    "transport ",
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
 * Custom transport implementation
 * 
 * This is a simple example that logs packets instead of sending them over a network.
 * Real implementations might use WebRTC data channels, custom WebSocket implementations,
 * or other transport mechanisms.
 */
class LoggingTransport {
  constructor(options = {}) {
    this.name = options.name || 'LoggingTransport';
    this.packetCount = 0;
    this.totalBytes = 0;
    console.log(`[${this.name}] Created custom transport`);
  }
  
  /**
   * Send method required by the TransportStream interface
   */
  send(data, callback) {
    this.packetCount++;
    this.totalBytes += data.length;
    
    // Log packet info
    console.log(`[${this.name}] Packet #${this.packetCount}: ${data.length} bytes`);
    
    // Optional: Dump the first few bytes of the packet
    const headerStr = data.slice(0, 12).toString('hex').match(/.{1,2}/g).join(' ');
    console.log(`[${this.name}] RTP Header: ${headerStr}`);
    
    // Get the text payload (skip the 12-byte RTP header)
    if (data.length > 12) {
      const payload = data.slice(12).toString('utf8');
      console.log(`[${this.name}] Payload: "${payload}"`);
    }
    
    // Call the callback with no error
    if (callback) {
      callback();
    }
  }
  
  /**
   * Close method (optional in the TransportStream interface)
   */
  close() {
    console.log(`[${this.name}] Transport closed. Stats: ${this.packetCount} packets, ${this.totalBytes} bytes total`);
  }
}

// EXAMPLE 1: Using a custom transport with T140RtpTransport directly
function directExample() {
  console.log("\n=== Example 1: Using custom transport directly with T140RtpTransport ===\n");

  // Create a custom transport
  const customTransport = new LoggingTransport({ name: "DirectExample" });
  
  // Create a T140RtpTransport with the custom transport
  const transport = new T140RtpTransport(
    "dummy-address", // This won't be used since we're using a custom transport
    5004,            // This won't be used either
    {
      customTransport, // Pass the custom transport
      payloadType: 96,
      redEnabled: true, // Enable redundancy to see how it works with custom transport
      redPayloadType: 98,
      redundancyLevel: 2,
    }
  );
  
  // Send some text
  transport.sendText("Hello, world!");
  transport.sendText("This is a second message.");
  
  // Close the transport
  transport.close();
}

// EXAMPLE 2: Using a custom transport with processAIStreamToRtp
function rtpExample() {
  console.log("\n=== Example 2: Using custom transport with processAIStreamToRtp ===\n");

  // Create a mock AI stream
  const stream = createMockAIStream();
  
  // Create a custom transport
  const customTransport = new LoggingTransport({ name: "RtpExample" });
  
  // Process the stream with the custom transport
  const transport = processAIStreamToRtp(
    stream,
    "dummy-address", // Not used with custom transport
    5004,            // Not used with custom transport
    {
      customTransport,
      payloadType: 96,
      fecEnabled: true, // Enable FEC to see how it works with custom transport
      fecPayloadType: 97,
      fecGroupSize: 3,
    }
  );
  
  // The transport will be closed automatically when the stream ends
}

// EXAMPLE 3: Using a custom transport with processAIStreamToSrtp
function srtpExample() {
  console.log("\n=== Example 3: Using custom transport with processAIStreamToSrtp ===\n");

  // Create a mock AI stream
  const stream = createMockAIStream();
  
  // Create a custom transport
  const customTransport = new LoggingTransport({ name: "SrtpExample" });
  
  // Generate SRTP keys
  const { masterKey, masterSalt } = createSrtpKeysFromPassphrase("test-passphrase");
  
  // Process the stream with the custom transport using SRTP
  const transport = processAIStreamToSrtp(
    stream,
    "dummy-address", // Not used with custom transport
    {
      masterKey,
      masterSalt,
      customTransport,
      payloadType: 96,
    },
    5006 // Not used with custom transport
  );
  
  // The transport will be closed automatically when the stream ends
}

// Run the examples
directExample();
setTimeout(rtpExample, 1000);
// SRTP example is disabled for now due to an issue with werift-rtp dependency
// Error: SrtpPolicy is not a constructor
// To enable this example, ensure werift-rtp is properly installed and configured
// setTimeout(srtpExample, 7000);