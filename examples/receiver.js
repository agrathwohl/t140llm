const dgram = require('dgram');
const WebSocket = require('ws');

// extractT140Text handles both text/t140 and text/red packets. Redundancy is on
// by default (RFC 4103 section 4), so the text is not simply at byte offset 12.
const { extractT140Text, parseT140RedPacket } = require('../dist');

// Payload type the sender uses for text/red
const RED_PAYLOAD_TYPE = 98;

// Set up UDP receivers for RTP and direct text 
// Create socket for standard RTP
const rtpSocket = dgram.createSocket('udp4');
rtpSocket.bind(5004);
console.log('RTP receiver listening on port 5004');

// Create socket for SRTP
const srtpSocket = dgram.createSocket('udp4');
srtpSocket.bind(5006);
console.log('SRTP receiver listening on port 5006 (encryption not decoded)');

// Create socket for direct transmission
const directSocket = dgram.createSocket('udp4');
directSocket.bind(5008);
console.log('Direct text receiver listening on port 5008');

// Create WebSocket client to receive from the server
const wsClient = new WebSocket('ws://localhost:8765');
console.log('WebSocket client connecting to ws://localhost:8765');

// Track received messages for each transport
const received = {
  rtp: '',
  srtp: '',
  direct: '',
  websocket: ''
};

// RTP socket handler - extract the primary T140block from each packet
rtpSocket.on('message', (msg) => {
  if (msg.length <= 12) {
    return;
  }

  const payload = extractT140Text(msg, RED_PAYLOAD_TYPE);

  // With redundancy on, each packet also repeats earlier blocks. Show them so
  // you can see what would be recoverable if this packet were the only arrival.
  if ((msg[1] & 0x7f) === RED_PAYLOAD_TYPE) {
    const red = parseT140RedPacket(msg);
    const ages = red.redundant.map((b) => `${b.timestampOffset}ms`).join(', ');
    console.log(
      `RTP received: "${payload}" (seq ${red.sequenceNumber}, ` +
      `${red.redundant.length} redundant block(s)${ages ? `: ${ages}` : ''})`
    );
  } else {
    console.log(`RTP received: ${payload}`);
  }

  received.rtp += payload;
});

// SRTP socket handler - extract payload from SRTP packets
// Note: We're not decrypting the SRTP here, just showing reception
srtpSocket.on('message', (msg) => {
  console.log(`SRTP packet received (${msg.length} bytes, encrypted)`);
  // In a real implementation, we would decrypt this
  received.srtp += '.'; // Just track that we received something
});

// Direct socket handler - just receive the text directly
directSocket.on('message', (msg) => {
  const text = msg.toString('utf-8');
  console.log(`Direct received: ${text}`);
  received.direct += text;
});

// WebSocket client handlers
wsClient.on('open', () => {
  console.log('WebSocket connection established');
});

// Without this listener a refused connection would exit the process. Start the
// WebSocket server first, or ignore this leg and watch the UDP ports.
wsClient.on('error', (err) => {
  console.log(`WebSocket not available: ${err.message}`);
});

wsClient.on('message', (data) => {
  const text = data.toString();
  console.log(`WebSocket received: ${text}`);
  received.websocket += text;
});

// Print summary after a timeout
setTimeout(() => {
  console.log('\n=== RECEPTION SUMMARY ===');
  console.log(`WebSocket received ${received.websocket.length} characters`);
  console.log(`RTP received ${received.rtp.length} characters`);
  console.log(`SRTP received ${received.srtp.length} markers (encrypted)`);
  console.log(`Direct received ${received.direct.length} characters`);
  
  // Print completeness of the message for RTP and Direct
  const completeMessage = "This is a demonstration of T140LLM library. It shows how to transmit text streams efficiently over different transport mechanisms including WebSockets, RTP, and SRTP. This library is particularly useful for real-time text transmission in applications like chat, accessibility services, or streaming AI outputs.";
  
  console.log('\n=== MESSAGE COMPLETENESS ===');
  if (received.rtp.length > 0) {
    const rtpComplete = received.rtp === completeMessage;
    console.log(`RTP message complete: ${rtpComplete}`);
  }
  
  if (received.direct.length > 0) {
    const directComplete = received.direct === completeMessage;
    console.log(`Direct message complete: ${directComplete}`);
  }

  if (received.websocket.length > 0) {
    const wsComplete = received.websocket === completeMessage;
    console.log(`WebSocket message complete: ${wsComplete}`);
  }
  
  console.log('\nReceiver will keep running until manually terminated (Ctrl+C)');
}, 20000); // 20 seconds should be enough for all demos to complete

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('\nClosing receivers...');
  rtpSocket.close();
  srtpSocket.close();
  directSocket.close();
  wsClient.close();
  process.exit();
});