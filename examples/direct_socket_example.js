// Direct Socket Mode Example for T140LLM
// This example demonstrates using the direct socket mode to bypass WebSocket
// while still maintaining RTP encapsulation for T.140 data

const { EventEmitter } = require('events');
const { processAIStreamToDirectSocket } = require('../dist/index');

// Create a mock AI stream for demonstration purposes
class MockAIStream extends EventEmitter {
  constructor() {
    super();
  }
  
  // Simulate an AI stream sending chunks of text
  simulate() {
    const messages = [
      "Hello,",
      " this",
      " is",
      " a",
      " demonstration",
      " of",
      " the",
      " direct",
      " socket",
      " mode",
      " for",
      " T.140",
      " over",
      " RTP."
    ];
    
    console.log('Starting simulation of AI stream...');
    
    let index = 0;
    const interval = setInterval(() => {
      if (index < messages.length) {
        console.log(`Sending chunk: "${messages[index]}"`);
        this.emit('data', messages[index]);
        index++;
      } else {
        console.log('Simulation complete.');
        clearInterval(interval);
        this.emit('end');
      }
    }, 500); // Send a chunk every 500ms
    
    return this;
  }
}

console.log('T140LLM Direct Socket Mode Example');
console.log('-----------------------------------');
console.log('This example demonstrates sending text directly to a SEQPACKET socket');
console.log('with RTP encapsulation, bypassing the WebSocket intermediary.');
console.log('');
console.log('The socket needs to be already created at /tmp/seqpacket_socket');
console.log('For example, using: "socat -u UNIX-LISTEN:/tmp/seqpacket_socket,type=seqpacket STDIO"');
console.log('');

// Create a mock AI stream
const aiStream = new MockAIStream();

try {
  // Process the AI stream using direct socket mode
  // This will send RTP-encapsulated T.140 data directly to the SEQPACKET socket
  console.log('Setting up direct socket mode...');
  const socket = processAIStreamToDirectSocket(aiStream, '/tmp/seqpacket_socket', {
    // Optional RTP configuration
    payloadType: 96,
    ssrc: 12345,
    initialSequenceNumber: 0,
    initialTimestamp: 0,
    timestampIncrement: 160
  });
  
  // Set up event handlers
  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
  
  socket.on('connect', () => {
    console.log('Connected to SEQPACKET socket. Starting simulation...');
    // Start sending data once connected
    aiStream.simulate();
  });
  
  socket.on('close', () => {
    console.log('Socket closed.');
  });
  
} catch (error) {
  console.error('Failed to setup direct socket mode:', error);
}