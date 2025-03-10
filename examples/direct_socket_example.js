// UDP RTP Mode Example for T140LLM
// This example demonstrates using UDP RTP transport to send T.140 data
// to a SEQPACKET socket via a UDP bridge

require("dotenv/config");
const { EventEmitter } = require("events");
const { processAIStreamToRtp } = require("../dist/index");
const Anthropic = require("@anthropic-ai/sdk");
const { Readable } = require("stream");

const anthropic = new Anthropic();

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
      " RTP.",
    ];

    console.log("Starting simulation of AI stream...");

    let index = 0;
    const interval = setInterval(() => {
      if (index < messages.length) {
        console.log(`Sending chunk: "${messages[index]}"`);
        this.emit("data", messages[index]);
        index++;
      } else {
        console.log("Simulation complete.");
        clearInterval(interval);
        this.emit("end");
      }
    }, 500); // Send a chunk every 500ms

    return this;
  }
}

console.log("T140LLM Direct Socket Mode Example");
console.log("-----------------------------------");
console.log(
  "This example demonstrates sending text directly to a SEQPACKET socket",
);
console.log("with RTP encapsulation, bypassing the WebSocket intermediary.");
console.log("");
console.log("This example requires the seqpacket.js UDP bridge running");
console.log('Run the seqpacket.js example first: "node examples/seqpacket.js"');
console.log(
  "This example will send UDP packets to port 5004 which then forwards to SEQPACKET",
);
console.log("");

// Create a mock AI stream
const aiStream = new MockAIStream();

async function main() {
  try {
    const stream = await anthropic.messages.create({
      max_tokens: 2048,
      messages: [{ role: "user", content: "Hello, Claude" }],
      model: "claude-3-5-sonnet-latest",
      stream: true,
    });
    console.log(stream);
    // For UDP we need to use RTP mode instead of Direct Socket mode
    console.log("Setting up RTP mode to send to UDP...");
    const remoteAddress = "127.0.0.1"; // Local UDP server
    const remotePort = 5004; // Standard RTP port
    console.log(`Sending to UDP: ${remoteAddress}:${remotePort}`);

    const rs = Readable.from(stream);
    rs.on("data", (d) => console.log(`${d}`, JSON.stringify(d)));
    // Use processAIStreamToRtp instead of processAIStreamToDirectSocket
    const transport = processAIStreamToRtp(rs, remoteAddress, remotePort, {
      // Optional RTP configuration
      payloadType: 96,
      ssrc: 12345,
      initialSequenceNumber: 0,
      initialTimestamp: 0,
      timestampIncrement: 160,
    });

    // Event handlers for transport errors
    transport.udpSocket.on("error", (err) => {
      console.error("UDP socket error:", err);
    });

    // Start the simulation immediately
    console.log("UDP socket created. Starting simulation...");
    //aiStream.simulate();

    // Add a cleanup handler for when simulation ends
    aiStream.on("end", () => {
      console.log("Simulation ended, closing transport...");
      transport.close();
    });
  } catch (error) {
    console.error("Failed to setup direct socket mode:", error);
  }
}

main();
