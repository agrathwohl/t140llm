# T140LLM Steganography Examples

This directory contains examples demonstrating how to use the steganography features of the T140LLM library.

## Overview

The steganography module allows you to hide RTP packets within cover media (such as audio samples, image data, etc.)
to provide an additional layer of security and obfuscation for your real-time text communications.

**Powered by [llm-steg](https://github.com/agrathwohl/llm-steg)** - A transport-agnostic steganography library.

Key features:
- LSB (Least Significant Bit) steganography algorithm
- Customizable steganography transports
- Integration with RTP packet streaming
- Transport-agnostic design

## Examples

### 1. LSB Steganography Example

The `llm_steg_example.js` file demonstrates how to use LSB steganography to encode RTP packets within cover media.

To run this example:
```bash
npm run build
node examples/steganography/llm_steg_example.js
```

This example shows:
- Direct encode/decode operations
- Integration with AI stream processing
- Cover media generation

### 2. Custom Steganography Transport

The `custom_steg_transport_example.js` file shows how to create a custom steganography transport with advanced features like:
- Packet tracking and statistics
- Bit change analysis
- Integration with the T140RTP transport system

To run this example:
```bash
npm run build
node examples/steganography/custom_steg_transport_example.js
```

## Implementation Details

The steganography system consists of:

1. **StegTransport**: A transport wrapper that applies steganography to packets (uses llm-steg internally)
2. **LSBAlgorithm**: LSB steganography from llm-steg for encoding/decoding
3. **RTP Extensions**: Extensions to the RTP configuration to support steganography

The LSB (Least Significant Bit) algorithm encodes data in the least significant bits of cover media bytes. This provides a good balance of capacity and resilience.

### Capacity

- Each byte of cover media can store 1 bit of secret data
- A 10KB cover media can hide ~1.2KB of secret data
- 4 bytes are reserved for the length header

## Security Considerations

- Steganography adds obfuscation but is not a replacement for proper encryption (SRTP)
- Cover media should be carefully selected to avoid statistical detection
- The llm-steg library provides a well-tested, secure implementation

## Usage in Production

When using these steganography features in production:

1. Combine with SRTP encryption for maximum security
2. Use high-quality, diverse cover media
3. Consider implementing custom steganalysis detection to evaluate your implementation
4. Monitor the expansion ratio to ensure efficient bandwidth usage

## API Reference

### StegTransport

```javascript
const { StegTransport } = require('t140llm');

const steg = new StegTransport(innerTransport, {
  enabled: true,
  encodeMode: 'fixed',
  coverMedia: [Buffer.alloc(1024)],
  seed: 'optional-seed'
});

// Encode data into cover media
const encoded = steg.encode(data, coverMedia);

// Decode hidden data
const decoded = steg.decode(encoded);

// Get configuration
const config = steg.getConfig();

// Update configuration
steg.updateConfig({ enabled: false });
```

### Factory Functions

```javascript
const { createStegT140RtpTransport, processAIStreamToStegRtp } = require('t140llm');

// Create RTP transport with steganography
const transport = createStegT140RtpTransport('127.0.0.1', 5004, {
  steganography: {
    enabled: true,
    coverMedia: [coverBuffer]
  }
});

// Process AI stream with steganography
const transport = processAIStreamToStegRtp(stream, '127.0.0.1', 5004, {
  steganography: {
    enabled: true,
    coverMedia: [coverBuffer]
  }
});
```

## Additional Resources

For more information on steganography techniques:
- [llm-steg documentation](https://github.com/agrathwohl/llm-steg)
- [Steganography on Wikipedia](https://en.wikipedia.org/wiki/Steganography)
- [Introduction to Modern Steganography](https://www.sciencedirect.com/topics/computer-science/steganography)
