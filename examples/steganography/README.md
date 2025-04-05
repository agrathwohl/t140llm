# T140LLM Steganography Examples

This directory contains examples demonstrating how to use the steganography features of the T140LLM library.

## Overview

The steganography module allows you to hide RTP packets within cover media (such as audio samples, image data, etc.) 
to provide an additional layer of security and obfuscation for your real-time text communications.

Key features:
- LLM-generated steganography algorithms
- Customizable steganography transports
- Integration with RTP packet streaming

## Examples

### 1. LLM-Generated Steganography

The `llm_steg_example.js` file demonstrates how to use an LLM (OpenAI's GPT models) to generate a custom steganography algorithm that is then used to encode RTP packets.

To run this example:
1. Create a `.env` file in the project root with your OpenAI API key: `OPENAI_API_KEY=your-key-here`
2. Install the OpenAI SDK: `npm install openai dotenv`
3. Run the example: `node examples/steganography/llm_steg_example.js`

### 2. Custom Steganography Transport

The `custom_steg_transport_example.js` file shows how to create a custom steganography transport with advanced features like:
- Custom encoding/decoding algorithms
- Statistical analysis of the steganography process
- Integration with the T140RTP transport system

To run this example:
```
node examples/steganography/custom_steg_transport_example.js
```

## Implementation Details

The steganography system consists of:

1. **StegTransport**: A transport wrapper that applies steganography to packets
2. **LLM Integration**: Functionality to generate steganography algorithms using LLMs
3. **RTP Extensions**: Extensions to the RTP configuration to support steganography

The default algorithm uses LSB (Least Significant Bit) steganography, which encodes data in the least significant bits of cover media bytes. This provides a good balance of capacity and resilience.

## Security Considerations

- Steganography adds obfuscation but is not a replacement for proper encryption (SRTP)
- The security of LLM-generated algorithms depends on the quality of the prompt and model
- Cover media should be carefully selected to avoid statistical detection

## Usage in Production

When using these steganography features in production:

1. Combine with SRTP encryption for maximum security
2. Use high-quality, diverse cover media
3. Consider implementing custom steganalysis detection to evaluate your implementation
4. Regularly update your steganography algorithms to prevent pattern recognition

## Additional Resources

For more information on steganography techniques:
- [Steganography on Wikipedia](https://en.wikipedia.org/wiki/Steganography)
- [Introduction to Modern Steganography](https://www.sciencedirect.com/topics/computer-science/steganography)
- [Digital Watermarking and Steganography](https://www.sciencedirect.com/book/9780123725851/digital-watermarking-and-steganography)