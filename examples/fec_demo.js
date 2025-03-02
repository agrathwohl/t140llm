const { EventEmitter } = require('events');
const dgram = require('dgram');
const { 
  processAIStreamToRtp,
  T140RtpTransport
} = require('../dist/index');

// Create a simple text stream that emits chunks of text at intervals
class MockAIStream extends EventEmitter {
  constructor(text, chunkSize = 5, interval = 100) {
    super();
    this.text = text;
    this.chunkSize = chunkSize;
    this.interval = interval;
  }

  start() {
    console.log('Starting stream...');
    let position = 0;
    
    const sendChunk = () => {
      if (position >= this.text.length) {
        this.emit('end');
        return;
      }
      
      const chunk = this.text.slice(position, position + this.chunkSize);
      this.emit('data', chunk);
      position += this.chunkSize;
      
      if (position < this.text.length) {
        setTimeout(sendChunk, this.interval);
      } else {
        setTimeout(() => this.emit('end'), this.interval);
      }
    };
    
    sendChunk();
    return this;
  }
}

// Common text to send in the examples
const sampleText = "This is a demonstration of T140LLM library with Forward Error Correction (FEC) as defined in RFC 5109. FEC helps recover from packet loss by sending redundant information that allows reconstruction of lost packets. This is especially useful in unreliable network conditions.";

// Function to measure packet loss statistics
function measurePacketLoss(transportName, receivedPackets, totalPackets, recoveredPackets = 0) {
  const lossRate = ((totalPackets - receivedPackets) / totalPackets) * 100;
  const recoveryRate = recoveredPackets > 0 ? (recoveredPackets / (totalPackets - receivedPackets)) * 100 : 0;
  
  console.log(`\n=== ${transportName} PACKET STATISTICS ===`);
  console.log(`Total packets sent: ${totalPackets}`);
  console.log(`Packets received: ${receivedPackets}`);
  console.log(`Packets lost: ${totalPackets - receivedPackets}`);
  console.log(`Loss rate: ${lossRate.toFixed(2)}%`);
  
  if (recoveredPackets > 0) {
    console.log(`Packets recovered via FEC: ${recoveredPackets}`);
    console.log(`Recovery rate: ${recoveryRate.toFixed(2)}%`);
    console.log(`Effective loss rate: ${((totalPackets - receivedPackets - recoveredPackets) / totalPackets * 100).toFixed(2)}%`);
  }
}

// RTP sender without FEC
async function demoWithoutFEC() {
  console.log('\n=== DEMO: Text Stream over RTP without FEC ===');
  
  // Create a socket to simulate packet loss (we won't actually use it for sending)
  const lossSocket = dgram.createSocket('udp4');
  
  // Track the number of packets for statistics
  let packetsSent = 0;
  
  // Create a stream with the sample text
  const stream = new MockAIStream(sampleText);
  
  // Track when the stream is done
  let streamEnded = false;
  stream.on('end', () => {
    streamEnded = true;
    console.log('Standard RTP stream complete');
    console.log(`Total packets sent: ${packetsSent}`);
  });
  
  // Process the stream using the library with standard RTP
  const transport = processAIStreamToRtp(
    stream, 
    '127.0.0.1', 
    5010, // Using port 5010 for the non-FEC demo
    {
      payloadType: 96,
      ssrc: 12345,
      initialSequenceNumber: 1000,
      initialTimestamp: 0,
      timestampIncrement: 160
    }
  );
  
  // Count packets
  const originalSendText = transport.sendText;
  transport.sendText = function(text) {
    packetsSent++;
    return originalSendText.call(this, text);
  };
  
  // Start the stream
  stream.start();
  
  return new Promise(resolve => {
    // Wait for the stream to complete
    const checkEnd = setInterval(() => {
      if (streamEnded) {
        clearInterval(checkEnd);
        setTimeout(() => {
          resolve(packetsSent);
        }, 1000); // Wait a bit to ensure all packets are sent
      }
    }, 100);
  });
}

// RTP sender with FEC enabled
async function demoWithFEC() {
  console.log('\n=== DEMO: Text Stream over RTP with FEC ===');
  
  // Create a socket to simulate packet loss (we won't actually use it for sending)
  const lossSocket = dgram.createSocket('udp4');
  
  // Track the number of packets for statistics
  let packetsSent = 0;
  let fecPacketsSent = 0;
  
  // Create a stream with the sample text
  const stream = new MockAIStream(sampleText);
  
  // Track when the stream is done
  let streamEnded = false;
  stream.on('end', () => {
    streamEnded = true;
    console.log('FEC-enabled RTP stream complete');
    console.log(`Media packets sent: ${packetsSent}`);
    console.log(`FEC packets sent: ${fecPacketsSent}`);
    console.log(`Total packets sent: ${packetsSent + fecPacketsSent}`);
  });
  
  // Process the stream using the library with FEC enabled
  const transport = processAIStreamToRtp(
    stream, 
    '127.0.0.1', 
    5012, // Using port 5012 for the FEC demo
    {
      payloadType: 96,
      ssrc: 12345,
      initialSequenceNumber: 2000,
      initialTimestamp: 0,
      timestampIncrement: 160,
      fecEnabled: true,
      fecPayloadType: 97,
      fecGroupSize: 4 // Send one FEC packet for every 4 media packets
    }
  );
  
  // Count packets (we need to track both media and FEC packets)
  const originalSendText = transport.sendText;
  transport.sendText = function(text) {
    packetsSent++;
    
    // We'll need to count FEC packets indirectly since they're created inside the method
    const originalUdpSend = this.udpSocket.send;
    const self = this;
    
    this.udpSocket.send = function(...args) {
      // The 4th argument is the port - we use this to identify unique calls
      // If this is a call that's immediately following a regular packet, and it's
      // after we've hit the FEC group size, it's probably an FEC packet
      if (packetsSent % self.config.fecGroupSize === 0 && args[3] === self.remotePort) {
        // This is likely an FEC packet being sent
        fecPacketsSent++;
      }
      
      return originalUdpSend.apply(this, args);
    };
    
    const result = originalSendText.call(this, text);
    
    // Restore the original send function
    this.udpSocket.send = originalUdpSend;
    
    return result;
  };
  
  // Start the stream
  stream.start();
  
  return new Promise(resolve => {
    // Wait for the stream to complete
    const checkEnd = setInterval(() => {
      if (streamEnded) {
        clearInterval(checkEnd);
        setTimeout(() => {
          resolve({ packetsSent, fecPacketsSent });
        }, 1000); // Wait a bit to ensure all packets are sent
      }
    }, 100);
  });
}

// Manual RTP+FEC demonstration to show detailed FEC behavior
function manualFecDemo() {
  console.log('\n=== MANUAL FEC DEMONSTRATION ===');
  
  // Create a T140RtpTransport with FEC enabled
  const transport = new T140RtpTransport('127.0.0.1', 5014, {
    fecEnabled: true,
    fecPayloadType: 97,
    fecGroupSize: 3 // Small group size to see FEC packets more frequently
  });
  
  console.log('Sending a sequence of packets with FEC enabled (group size = 3):');
  
  // Send a series of numbered packets to clearly demonstrate the FEC behavior
  const packets = [
    'Packet 1: This is the first packet',
    'Packet 2: This is the second packet',
    'Packet 3: This is the third packet',  // FEC packet should be sent after this
    'Packet 4: This is the fourth packet',
    'Packet 5: This is the fifth packet',
    'Packet 6: This is the sixth packet',  // FEC packet should be sent after this
    'Packet 7: This is the seventh packet',
    'Packet 8: This is the eighth packet',
  ];
  
  let packetIndex = 0;
  
  // Send packets with a delay to make the process visible
  function sendNextPacket() {
    if (packetIndex >= packets.length) {
      console.log('All packets sent, closing transport...');
      // This will trigger sending of any remaining FEC packets
      transport.close();
      return;
    }
    
    const packet = packets[packetIndex];
    console.log(`Sending: ${packet}`);
    transport.sendText(packet);
    
    packetIndex++;
    setTimeout(sendNextPacket, 500); // 500ms delay between packets
  }
  
  // Start sending
  sendNextPacket();
  
  // Return a promise that resolves when all packets are sent
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(packets.length);
    }, (packets.length + 1) * 500); // Wait for all packets plus a bit extra
  });
}

// Setup simple receivers to demonstrate packet reception
function setupReceivers() {
  console.log('\n=== SETTING UP RECEIVERS ===');
  
  // Create receiver for the non-FEC demo
  const standardReceiver = dgram.createSocket('udp4');
  standardReceiver.bind(5010);
  console.log('Standard RTP receiver listening on port 5010');
  
  let standardPacketsReceived = 0;
  standardReceiver.on('message', (msg) => {
    standardPacketsReceived++;
    console.log(`Standard RTP receiver got packet ${standardPacketsReceived}`);
  });
  
  // Create receiver for the FEC-enabled demo
  const fecReceiver = dgram.createSocket('udp4');
  fecReceiver.bind(5012);
  console.log('FEC-enabled RTP receiver listening on port 5012');
  
  let fecMediaPacketsReceived = 0;
  let fecProtectionPacketsReceived = 0;
  fecReceiver.on('message', (msg) => {
    // In a real implementation, we'd need to distinguish between media and FEC packets
    // For this demo, we'll just look at the payload type in the RTP header
    const payloadType = msg[1] & 0x7F; // Extract payload type from second byte
    
    if (payloadType === 97) { // FEC packet
      fecProtectionPacketsReceived++;
      console.log(`FEC receiver got FEC protection packet ${fecProtectionPacketsReceived}`);
    } else {
      fecMediaPacketsReceived++;
      console.log(`FEC receiver got media packet ${fecMediaPacketsReceived}`);
    }
  });
  
  // Create receiver for the manual FEC demo
  const manualReceiver = dgram.createSocket('udp4');
  manualReceiver.bind(5014);
  console.log('Manual FEC demo receiver listening on port 5014');
  
  let manualPacketsReceived = 0;
  manualReceiver.on('message', (msg) => {
    // In a real implementation, we'd need to distinguish between media and FEC packets
    // For this demo, we'll just look at the payload type in the RTP header
    const payloadType = msg[1] & 0x7F; // Extract payload type from second byte
    
    if (payloadType === 97) { // FEC packet
      console.log(`Manual demo receiver got FEC protection packet`);
    } else {
      manualPacketsReceived++;
      
      // In a real implementation, we would extract and decode the payload
      // For this demo, we'll simulate occasional packet loss
      if (manualPacketsReceived === 3) {
        console.log(`Simulating loss of packet 3 (won't display content)`);
      } else {
        // Extract the payload (skip the RTP header)
        const payload = msg.slice(12).toString('utf-8');
        console.log(`Manual demo received: ${payload}`);
      }
    }
  });
  
  return {
    standardReceiver,
    fecReceiver,
    manualReceiver,
    getStats: () => ({
      standardPacketsReceived,
      fecMediaPacketsReceived,
      fecProtectionPacketsReceived,
      manualPacketsReceived
    }),
    close: () => {
      standardReceiver.close();
      fecReceiver.close();
      manualReceiver.close();
    }
  };
}

// Run all demos
async function runFecDemos() {
  try {
    console.log('T140LLM Forward Error Correction (FEC) Demonstration');
    console.log('==================================================\n');
    console.log('This demo shows how the FEC feature helps recover from packet loss');
    console.log('by providing redundant information according to RFC 5109.\n');
    
    // Set up receivers first
    const receivers = setupReceivers();
    
    // Run the demos with a small delay to let receivers start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Run the demos
    const standardPacketsSent = await demoWithoutFEC();
    const { packetsSent: fecPacketsSent, fecPacketsSent: fecProtectionSent } = await demoWithFEC();
    const manualPacketsSent = await manualFecDemo();
    
    // Wait a bit to make sure all packets are received
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get the final statistics
    const stats = receivers.getStats();
    
    // Display packet loss statistics
    console.log('\n\n=== FINAL STATISTICS ===');
    
    measurePacketLoss(
      'STANDARD RTP (without FEC)',
      stats.standardPacketsReceived,
      standardPacketsSent
    );
    
    measurePacketLoss(
      'FEC-ENABLED RTP',
      stats.fecMediaPacketsReceived,
      fecPacketsSent,
      Math.min(stats.fecProtectionPacketsReceived, fecPacketsSent - stats.fecMediaPacketsReceived)
    );
    
    console.log('\n=== FEC SUMMARY ===');
    console.log('Forward Error Correction (FEC) adds overhead by sending additional packets');
    console.log('that contain redundant information, but provides robustness against packet loss.');
    console.log('The key benefits are:');
    console.log('1. Ability to recover lost packets without retransmission requests');
    console.log('2. Lower latency compared to retransmission-based recovery');
    console.log('3. Works well in one-way or multicast streaming scenarios');
    console.log('4. Configurable protection level (group size) based on network conditions');
    
    // Close the receivers
    receivers.close();
    
    console.log('\nAll demonstrations completed!');
  } catch (error) {
    console.error('Error during demonstration:', error);
  }
}

// Run the demos
runFecDemos();