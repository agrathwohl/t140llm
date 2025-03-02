# T140LLM Examples

This directory contains examples demonstrating the T140LLM library for transmitting text streams using T.140 protocol over different transport mechanisms.

## Demos

### 1. Basic Demonstration (`demo.js`)

This script demonstrates sending text streams through different transport mechanisms:
- WebSocket
- RTP (Real-time Transport Protocol)
- SRTP (Secure Real-time Transport Protocol)
- Direct Socket Mode (bypasses WebSocket but still uses RTP)
- Direct UDP (for comparison)

It also includes a performance comparison between the library and direct transmission.

### 2. Receiver (`receiver.js`)

This script shows how to receive the transmitted text streams:
- Listens on UDP ports for RTP, SRTP, and direct text
- Connects to the WebSocket server to receive WebSocket streams
- Tracks and displays received data for each transport mechanism

### 3. Forward Error Correction Demo (`fec_demo.js`)

This script demonstrates the Forward Error Correction (FEC) feature according to RFC 5109:
- Compares transmission with and without FEC enabled
- Shows how to configure FEC parameters (payload type, group size)
- Simulates packet loss to demonstrate recovery capabilities
- Provides statistics on packet loss and recovery rates
- Includes a manual demonstration with step-by-step packet transmission

### 4. Direct Socket Mode Example (`direct_socket_example.js`)

This script demonstrates the direct socket mode, which bypasses WebSocket but still uses RTP:
- Sends T.140 data directly to a SEQPACKET socket
- Maintains RTP encapsulation for compatibility
- Eliminates WebSocket overhead for local systems
- Provides an example of configuring RTP parameters for direct socket transmission

## Running the Examples

### Basic Demo

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

### FEC Demo

The FEC demo is self-contained and includes both sender and receiver components:

```
node examples/fec_demo.js
```

### Direct Socket Mode Demo

For the direct socket mode demo, you need to set up a SEQPACKET socket listener first:

1. **Install socat if not already available:**
```
sudo apt-get install socat  # For Debian/Ubuntu
# or
brew install socat  # For macOS
```

2. **In one terminal, start the SEQPACKET socket listener:**
```
socat -u UNIX-LISTEN:/tmp/seqpacket_socket,type=seqpacket STDIO
```

3. **In another terminal, run the direct socket example:**
```
node examples/direct_socket_example.js
```

You should see the received T.140 RTP packets in the first terminal.

## Expected Output

When running both scripts, you'll see:

1. The receiver will display incoming messages from each transport method
2. The demo will show the sending process for each transport method
3. Both will display timing and performance information

## Key Features Demonstrated

- T.140 real-time text transmission
- RTP packet creation and sequencing
- SRTP encryption for secure transmission
- Forward Error Correction (FEC) according to RFC 5109
- WebSocket transport
- Direct Socket Mode (local SEQPACKET socket with RTP)
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