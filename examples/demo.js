const { EventEmitter } = require("events");
const {
  processAIStreamToRtp,
  processAIStreamToSrtp,
  createSrtpKeysFromPassphrase,
  processAIStream,
  wss,
} = require("../dist/index");

// Create a simple text stream that emits chunks of text at intervals
class MockAIStream extends EventEmitter {
  constructor(text, chunkSize = 5, interval = 100) {
    super();
    this.text = text;
    this.chunkSize = chunkSize;
    this.interval = interval;
  }

  start() {
    console.log("Starting stream...");
    let position = 0;

    const sendChunk = () => {
      if (position >= this.text.length) {
        this.emit("end");
        return;
      }

      const chunk = this.text.slice(position, position + this.chunkSize);
      this.emit("data", chunk);
      position += this.chunkSize;

      if (position < this.text.length) {
        setTimeout(sendChunk, this.interval);
      } else {
        setTimeout(() => this.emit("end"), this.interval);
      }
    };

    sendChunk();
    return this;
  }
}

// Common text to send in all examples
const sampleText =
  "This is a demonstration of T140LLM library. It shows how to transmit text streams efficiently over different transport mechanisms including WebSockets, RTP, and SRTP. This library is particularly useful for real-time text transmission in applications like chat, accessibility services, or streaming AI outputs.";

// Function to measure time
function measureTime(fn) {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1000000; // Convert to milliseconds
}

// 1. Demo using WebSocket transport
function demoWebSocket() {
  console.log("\n=== DEMO: Text Stream over WebSocket ===");

  const stream = new MockAIStream(sampleText);

  // Track when the stream is done
  let streamEnded = false;
  stream.on("end", () => {
    streamEnded = true;
    console.log("WebSocket stream complete");
  });

  // Process the stream using library
  processAIStream(stream);

  // Start the stream
  stream.start();

  return new Promise((resolve) => {
    // Wait for the stream to complete
    const checkEnd = setInterval(() => {
      if (streamEnded) {
        clearInterval(checkEnd);
        resolve();
      }
    }, 100);
  });
}

// 2. Demo using RTP transport
function demoRTP() {
  console.log("\n=== DEMO: Text Stream over RTP ===");

  const stream = new MockAIStream(sampleText);

  // Track when the stream is done
  let streamEnded = false;
  stream.on("end", () => {
    streamEnded = true;
    console.log("RTP stream complete");
  });

  // Process the stream using library
  const transport = processAIStreamToRtp(stream, "127.0.0.1", 5004);

  // Start the stream
  stream.start();

  return new Promise((resolve) => {
    // Wait for the stream to complete
    const checkEnd = setInterval(() => {
      if (streamEnded) {
        clearInterval(checkEnd);
        resolve();
      }
    }, 100);
  });
}

// 3. Demo using SRTP transport
function demoSRTP() {
  console.log("\n=== DEMO: Text Stream over SRTP ===");

  const stream = new MockAIStream(sampleText);

  // Track when the stream is done
  let streamEnded = false;
  stream.on("end", () => {
    streamEnded = true;
    console.log("SRTP stream complete");
  });

  // Create SRTP keys from a passphrase
  const { masterKey, masterSalt } =
    createSrtpKeysFromPassphrase("SecureT140Demo");

  // Configure SRTP
  const srtpConfig = {
    masterKey,
    masterSalt,
    payloadType: 96,
    ssrc: 54321,
  };

  // Process the stream using library
  const transport = processAIStreamToSrtp(
    stream,
    "127.0.0.1",
    srtpConfig,
    5006,
  );

  // Start the stream
  stream.start();

  return new Promise((resolve) => {
    // Wait for the stream to complete
    const checkEnd = setInterval(() => {
      if (streamEnded) {
        clearInterval(checkEnd);
        resolve();
      }
    }, 100);
  });
}

// 4. Demo without the library - direct transmission
function demoWithoutLibrary() {
  console.log("\n=== DEMO: Text Stream without T140LLM library ===");

  const dgram = require("dgram");
  const socket = dgram.createSocket("udp4");

  // Simple text chunking and sending without RTP encapsulation
  function sendTextDirectly(text, remoteAddress, remotePort) {
    return new Promise((resolve) => {
      console.log("Starting direct transmission...");
      let position = 0;
      const chunkSize = 5;
      const interval = 100;

      const sendChunk = () => {
        if (position >= text.length) {
          socket.close();
          console.log("Direct transmission complete");
          resolve();
          return;
        }

        const chunk = text.slice(position, position + chunkSize);
        const buffer = Buffer.from(chunk, "utf-8");

        socket.send(
          buffer,
          0,
          buffer.length,
          remotePort,
          remoteAddress,
          (err) => {
            if (err) console.error("Error sending packet:", err);
          },
        );

        position += chunkSize;

        if (position < text.length) {
          setTimeout(sendChunk, interval);
        } else {
          setTimeout(() => {
            socket.close();
            console.log("Direct transmission complete");
            resolve();
          }, interval);
        }
      };

      sendChunk();
    });
  }

  return sendTextDirectly(sampleText, "127.0.0.1", 5008);
}

// 5. Performance comparison
async function comparePerformance() {
  console.log("\n=== PERFORMANCE COMPARISON ===");

  // Time the library RTP implementation
  const rtpTime = measureTime(() => {
    const stream = new MockAIStream(sampleText, 5, 0); // No delay for timing test
    const transport = processAIStreamToRtp(stream, "127.0.0.1", 5004);
    stream.start();
  });

  // Time the direct implementation
  const dgram = require("dgram");
  const directTime = measureTime(() => {
    const socket = dgram.createSocket("udp4");
    const chunkSize = 5;

    for (let i = 0; i < sampleText.length; i += chunkSize) {
      const chunk = sampleText.slice(i, i + chunkSize);
      const buffer = Buffer.from(chunk, "utf-8");
      socket.send(buffer, 0, buffer.length, 5008, "127.0.0.1");
    }

    socket.close();
  });

  console.log(`\nTime to process with T140LLM (RTP): ${rtpTime.toFixed(2)} ms`);
  console.log(`Time for direct transmission: ${directTime.toFixed(2)} ms`);
  console.log(`Overhead for T140LLM: ${(rtpTime - directTime).toFixed(2)} ms`);

  console.log("\nKey advantages of T140LLM:");
  console.log(
    "1. Proper RTP/SRTP encapsulation for standard-compliant transmission",
  );
  console.log("2. Sequence numbering and timestamp management");
  console.log("3. Multiple transport options (WebSocket, RTP, SRTP)");
  console.log("4. Support for various AI stream formats");
  console.log("5. Encryption options for secure transmission");
}

// Run all demos sequentially
async function runAllDemos() {
  try {
    console.log("T140LLM Demonstration");
    console.log("=====================\n");

    /*await demoWebSocket();
    await demoRTP();
    await demoSRTP();
    await demoWithoutLibrary();
    */
    await comparePerformance();

    console.log("\nAll demonstrations completed!");

    // Close the WebSocket server
    wss.close();
  } catch (error) {
    console.error("Error during demonstration:", error);
  }
}

// Run the demos
runAllDemos();

