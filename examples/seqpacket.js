const { SeqpacketServer, SeqpacketSocket } = require("node-unix-socket");
const fs = require("fs");
const dgram = require("dgram");

console.log("T140LLM SEQPACKET Socket Server Example");
console.log("---------------------------------------");
console.log("This server creates a SEQPACKET socket for direct_socket_example.js to use");
console.log("Run direct_socket_example.js in another terminal after this server is running");

const bindPath = "socket";
const UDP_PORT = 5004; // Standard RTP port

// Delete socket files if they already exist
try {
  fs.unlinkSync(bindPath);
} catch (e) {}

// Create a UDP server to bridge between UDP and SeqpacketSocket
const udpServer = dgram.createSocket('udp4');

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`UDP bridge listening on ${address.address}:${address.port}`);
});

let seqClient = null;

udpServer.on('message', (msg, rinfo) => {
  console.log(`Received UDP packet: ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
  
  // Create a SeqpacketSocket client if not already created
  if (!seqClient) {
    seqClient = new SeqpacketSocket();
    
    seqClient.connect(bindPath, () => {
      console.log("Connected to SEQPACKET server, bridge active");
      // Forward this message
      seqClient.write(msg);
    });
    
    seqClient.on("error", (err) => {
      console.error("SEQPACKET client error:", err);
      seqClient = null;
    });
    
    seqClient.on("close", () => {
      console.log("SEQPACKET connection closed");
      seqClient = null;
    });
  } else {
    // Forward the message to the SEQPACKET socket
    console.log(`Forwarding ${msg.length} bytes to SEQPACKET socket`);
    seqClient.write(msg);
  }
});

// Handle errors
udpServer.on('error', (err) => {
  console.error(`UDP server error:\n${err.stack}`);
  udpServer.close();
  if (seqClient) {
    seqClient.end();
    seqClient = null;
  }
});

// Start listening on the UDP port
udpServer.bind(UDP_PORT);

// Create and start the SEQPACKET server
console.log(`Creating SEQPACKET socket server at: ${bindPath}`);
const server = new SeqpacketServer();
server.listen(bindPath);

// Handle incoming connections
server.on("connection", (socket) => {
  console.log("SEQPACKET client connected!");
  
  // Log data received from clients
  socket.on("data", (buf) => {
    // For RTP packets, parse the header
    if (buf.length >= 12) { // RTP header is 12 bytes
      const version = (buf[0] >> 6) & 0x03;
      const padding = (buf[0] >> 5) & 0x01;
      const extension = (buf[0] >> 4) & 0x01;
      const csrcCount = buf[0] & 0x0F;
      const marker = (buf[1] >> 7) & 0x01;
      const payloadType = buf[1] & 0x7F;
      const sequenceNumber = buf.readUInt16BE(2);
      const timestamp = buf.readUInt32BE(4);
      const ssrc = buf.readUInt32BE(8);
      
      console.log(`Received RTP packet:`);
      console.log(`  Version: ${version}, PT: ${payloadType}, Seq: ${sequenceNumber}`);
      console.log(`  Timestamp: ${timestamp}, SSRC: ${ssrc}`);
      
      // Extract and show payload as text if possible
      if (buf.length > 12) {
        try {
          const payload = buf.slice(12).toString('utf8');
          console.log(`  Payload (${buf.length-12} bytes): "${payload}"`);
        } catch (e) {
          console.log(`  Payload: Binary data (${buf.length-12} bytes)`);
        }
      }
    } else {
      // Not an RTP packet
      console.log(`Received ${buf.length} bytes of non-RTP data`);
      try {
        console.log(`As text: ${buf.toString()}`);
      } catch (e) {}
    }
  });
  
  socket.on("close", () => {
    console.log("SEQPACKET client disconnected");
  });
  
  socket.on("error", (err) => {
    console.error("SEQPACKET socket error:", err);
  });
});

console.log("SEQPACKET socket server is running. Waiting for connections...");
console.log("Press Ctrl+C to stop the server");

// Handle process termination
process.on("SIGINT", () => {
  console.log("\nShutting down server...");
  server.close();
  udpServer.close();
  try {
    fs.unlinkSync(bindPath);
  } catch (e) {}
  process.exit(0);
});
