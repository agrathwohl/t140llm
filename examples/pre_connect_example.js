/**
 * Example demonstrating pre-connecting to a transport before the AI stream is available
 *
 * This approach is useful in scenarios where you want to:
 * 1. Establish the connection early to reduce latency when the stream starts
 * 2. Set up the transport independently from the LLM stream
 * 3. Reuse the same transport connection for multiple streams
 */

const {
  createT140WebSocketTransport,
  createDirectSocketTransport,
  createT140RtpTransport,
  createT140SrtpTransport,
  createSrtpKeysFromPassphrase,
} = require("../dist");

// Simulate an event emitter that will become our AI stream
const EventEmitter = require("events");

/**
 * Example 1: Pre-connecting with WebSocket transport
 */
function webSocketExample() {
  console.log("Pre-connecting with WebSocket transport...");

  // Create the WebSocket connection before the AI stream is available
  const { connection, attachStream } = createT140WebSocketTransport();

  console.log("WebSocket connection established, waiting for AI stream...");

  // Later, when the AI stream becomes available, attach it to the existing connection
  setTimeout(() => {
    console.log(
      "AI stream now available, attaching to existing WebSocket connection...",
    );

    // Create a mock AI stream
    const mockStream = new EventEmitter();

    // Attach the stream to our existing connection
    attachStream(mockStream, {
      processBackspaces: true,
      handleMetadata: true,
    });

    // Simulate stream data
    mockStream.emit("data", {
      text: "Hello from pre-connected WebSocket transport!",
    });

    // Simulate stream end
    setTimeout(() => {
      mockStream.emit("end");
      console.log("WebSocket example completed\n");
    }, 1000);
  }, 2000);
}

/**
 * Example 2: Pre-connecting with Direct Socket transport
 */
function directSocketExample() {
  console.log("Pre-connecting with Direct Socket transport...");

  // Create the direct socket connection before the AI stream is available
  const { transport, attachStream, rtpState } = createDirectSocketTransport();

  console.log(
    "Direct Socket connection established, RTP sequence starting at:",
    rtpState.sequenceNumber,
  );
  console.log("Waiting for AI stream...");

  // Later, when the AI stream becomes available, attach it to the existing connection
  setTimeout(() => {
    console.log(
      "AI stream now available, attaching to existing Direct Socket connection...",
    );

    // Create a mock AI stream
    const mockStream = new EventEmitter();

    // Attach the stream to our existing connection
    attachStream(mockStream, {
      processBackspaces: true,
      handleMetadata: true,
    });

    // Simulate stream data
    mockStream.emit("data", {
      text: "Hello from pre-connected Direct Socket transport!",
    });

    // Simulate stream end
    setTimeout(() => {
      mockStream.emit("end");
      console.log("Direct Socket example completed\n");
    }, 1000);
  }, 3000);
}

/**
 * Example 3: Pre-connecting with RTP transport
 */
function rtpExample() {
  console.log("Pre-connecting with RTP transport...");

  // Create the RTP transport before the AI stream is available
  const { transport, attachStream } = createT140RtpTransport(
    "127.0.0.1",
    5004,
    {
      charRateLimit: 50, // 50 characters per second
      // Redundancy (RFC 2198) is on by default. FEC is the alternative, so
      // turning FEC on here means turning RED off.
      redEnabled: false,
      fecEnabled: true,
    },
  );

  console.log("RTP transport established, waiting for AI stream...");

  // Later, when the AI stream becomes available, attach it to the existing connection
  setTimeout(() => {
    console.log(
      "AI stream now available, attaching to existing RTP transport...",
    );

    // Create a mock AI stream
    const mockStream = new EventEmitter();

    // Attach the stream to our existing connection
    attachStream(mockStream, {
      processBackspaces: true,
      handleMetadata: true,
    });

    // Simulate stream data
    mockStream.emit("data", {
      text: "Hello from pre-connected RTP transport!",
    });

    // Simulate stream end
    setTimeout(() => {
      mockStream.emit("end");
      console.log("RTP example completed\n");
    }, 1000);
  }, 4000);
}

/**
 * Example 4: Pre-connecting with SRTP transport
 */
function srtpExample() {
  console.log("Pre-connecting with SRTP transport...");

  // Generate SRTP keys from a passphrase
  const { masterKey, masterSalt } = createSrtpKeysFromPassphrase(
    "secure-t140-connection",
  );

  // Create the SRTP transport before the AI stream is available.
  // Argument order is (address, port, srtpConfig).
  const { transport, attachStream } = createT140SrtpTransport(
    "127.0.0.1",
    5006,
    {
      masterKey,
      masterSalt,
      processBackspaces: true,
    },
  );

  console.log("SRTP transport established, waiting for AI stream...");

  // Later, when the AI stream becomes available, attach it to the existing connection
  setTimeout(() => {
    console.log(
      "AI stream now available, attaching to existing SRTP transport...",
    );

    // Create a mock AI stream
    const mockStream = new EventEmitter();

    // Attach the stream to our existing connection
    attachStream(mockStream, {
      processBackspaces: true,
      handleMetadata: true,
    });

    // Simulate stream data
    mockStream.emit("data", {
      text: "Hello from pre-connected SRTP transport!",
    });

    // Simulate metadata
    mockStream.emit("data", {
      text: "",
      metadata: {
        type: "custom",
        content: { message: "This is metadata sent through SRTP transport" },
      },
    });

    // Simulate stream end
    setTimeout(() => {
      mockStream.emit("end");
      console.log("SRTP example completed\n");
    }, 1000);
  }, 5000);
}

// Run all examples in sequence
// Note: In a real application you would typically use only one of these transport types
webSocketExample();
directSocketExample();
rtpExample();
srtpExample();

// For SRTP without a shared passphrase, see dtls_srtp_example.js.

