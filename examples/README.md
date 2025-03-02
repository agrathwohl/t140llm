# T140LLM Examples

This directory contains examples demonstrating the T140LLM library for transmitting text streams using T.140 protocol over different transport mechanisms.

## Demos

### 1. Basic Demonstration (`demo.js`)

This script demonstrates sending text streams through different transport mechanisms:
- WebSocket
- RTP (Real-time Transport Protocol)
- SRTP (Secure Real-time Transport Protocol)
- Direct UDP (for comparison)

It also includes a performance comparison between the library and direct transmission.

### 2. Receiver (`receiver.js`)

This script shows how to receive the transmitted text streams:
- Listens on UDP ports for RTP, SRTP, and direct text
- Connects to the WebSocket server to receive WebSocket streams
- Tracks and displays received data for each transport mechanism

## Running the Examples

1. **Build the library first:**
```
npm run build
```

2. **Start the receiver in one terminal:**
```
node examples/receiver.js
```

3. **Run the demo in another terminal:**
```
node examples/demo.js
```

## Expected Output

When running both scripts, you'll see:

1. The receiver will display incoming messages from each transport method
2. The demo will show the sending process for each transport method
3. Both will display timing and performance information

## Key Features Demonstrated

- T.140 real-time text transmission
- RTP packet creation and sequencing
- SRTP encryption for secure transmission
- WebSocket transport
- Performance comparison with direct transmission
- Support for AI stream formats from various providers

## Real-World Applications

This library is particularly useful for:
- Real-time accessibility services
- Streaming AI-generated text outputs
- Chat applications requiring low latency
- Applications needing compliant real-time text transmission

## Notes

- The demo uses localhost for all connections
- The SRTP receiver doesn't decrypt received data (showing only reception)
- Default ports are configured in the library:
  - WebSocket: 8765
  - RTP: 5004
  - SRTP: 5006
  - Direct: 5008 (for comparison only)