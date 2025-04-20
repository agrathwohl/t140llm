const dgram = require('dgram');
const t140llm = require('../dist'); // Adjust path as needed

// Create a UDP socket to receive RTP packets
const socket = dgram.createSocket('udp4');

// Create a demultiplexer for T140 RTP streams
const demultiplexer = new t140llm.T140StreamDemultiplexer();

// Set up demultiplexer event handlers
demultiplexer.on('stream', (streamId, stream) => {
  console.log(`New stream detected: ${streamId}`);
  
  // Set up handlers for this specific stream
  stream.on('data', (text) => {
    console.log(`[${streamId}] ${text}`);
  });
  
  stream.on('metadata', (metadata) => {
    console.log(`[${streamId}] Metadata:`, metadata);
  });
  
  stream.on('end', () => {
    console.log(`[${streamId}] Stream ended`);
  });
});

demultiplexer.on('error', (err) => {
  console.error('Demultiplexer error:', err);
});

// Set up the UDP socket to receive packets
socket.on('message', (msg, rinfo) => {
  console.log(`Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
  
  // Process the packet through the demultiplexer
  // Use true for CSRC-based identification or false for prefix-based
  demultiplexer.processPacket(msg, true);
});

socket.on('listening', () => {
  const address = socket.address();
  console.log(`Listening for RTP packets on ${address.address}:${address.port}`);
});

socket.on('error', (err) => {
  console.error('Socket error:', err);
});

// Bind the socket to the RTP port
const PORT = 5004;
socket.bind(PORT);

// Handle termination gracefully
process.on('SIGINT', () => {
  console.log('Shutting down...');
  socket.close();
  process.exit(0);
});