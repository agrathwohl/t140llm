import { ProcessorOptions, SrtpConfig, TextDataStream } from '../interfaces';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { processT140BackspaceChars } from '../utils/backspace-processing';
import { DEFAULT_SRTP_PORT } from '../utils/constants';
import { extractTextFromChunk } from '../utils/extract-text';

/**
 * Create a T140 SRTP transport that can be used to send T.140 data securely
 * 
 * @param remoteAddress Remote address to send packets to
 * @param srtpConfig SRTP configuration including secure options
 * @param remotePort Remote port to send packets to
 * @returns The transport and a function to attach a stream to it
 */
export function createT140SrtpTransport(
  remoteAddress: string,
  srtpConfig: SrtpConfig,
  remotePort: number = DEFAULT_SRTP_PORT
): {
  transport: T140RtpTransport,
  attachStream: (stream: TextDataStream, processorOptions?: ProcessorOptions) => void
} {
  // Create transport
  const transport = new T140RtpTransport(remoteAddress, remotePort, srtpConfig);
  
  // Setup SRTP
  transport.setupSrtp(srtpConfig);
  
  // Function to attach a stream to this transport
  const attachStream = (stream: TextDataStream, processorOptions: ProcessorOptions = {}) => {
    let textBuffer = ''; // Buffer to track accumulated text for backspace handling
    const processBackspaces = processorOptions.processBackspaces === true || srtpConfig.processBackspaces === true;
    const handleMetadata = processorOptions.handleMetadata !== false && srtpConfig.handleMetadata !== false; // Default to true
    
    // Process the AI stream and send chunks over SRTP
    stream.on('data', (chunk) => {
      // Extract the text content and metadata from the chunk
      const { text, metadata } = extractTextFromChunk(chunk);
      
      // Handle metadata if present
      if (handleMetadata && metadata) {
        // Emit metadata event for external handling
        stream.emit('metadata', metadata);
        
        // Call metadata callback if provided
        const metadataCallback = processorOptions.metadataCallback || srtpConfig.metadataCallback;
        if (metadataCallback && typeof metadataCallback === 'function') {
          metadataCallback(metadata);
        }
      }
      
      // Skip if no text content
      if (!text) return;

      if (processBackspaces) {
        // Process backspaces in the T.140 stream
        const { processedText, updatedBuffer } = processT140BackspaceChars(
          text,
          textBuffer
        );
        textBuffer = updatedBuffer;

        // Only send if there's something to send
        if (processedText) {
          transport.sendText(processedText);
        }
      } else {
        // Send text directly without backspace processing
        transport.sendText(text);
      }
    });

    stream.on('end', () => {
      // Close the transport when stream ends
      transport.close();
    });

    // Handle errors from the input stream
    stream.on('error', (err) => {
      console.error('AI Stream error:', err);
      transport.close();
    });
  };
  
  // Forward errors from the transport for debugging
  transport.on('error', (err) => {
    console.error(`T140RtpTransport error (${err.type}):`, err.message);
  });
  
  return {
    transport,
    attachStream
  };
}

/**
 * Process an AI stream and send chunks directly as T.140 over SRTP
 *
 * @param stream The AI stream to process
 * @param remoteAddress Remote address to send packets to
 *  (required if customTransport is not provided)
 * @param srtpConfig SRTP configuration including custom transport if needed
 * @param remotePort Remote port to send packets to (defaults to DEFAULT_SRTP_PORT)
 * @param existingTransport Optional existing T140RtpTransport to use
 * @returns T140RtpTransport instance
 */
export function processAIStreamToSrtp(
  stream: TextDataStream,
  remoteAddress: string,
  srtpConfig: SrtpConfig,
  remotePort: number = DEFAULT_SRTP_PORT,
  existingTransport?: T140RtpTransport
): T140RtpTransport {
  // If an existing transport is provided, use it
  if (existingTransport) {
    // Make sure SRTP is set up on the existing transport
    existingTransport.setupSrtp(srtpConfig);
    
    const processorOptions: ProcessorOptions = {
      processBackspaces: srtpConfig.processBackspaces,
      handleMetadata: srtpConfig.handleMetadata,
      metadataCallback: srtpConfig.metadataCallback
    };
    
    const { attachStream } = createT140SrtpTransport(remoteAddress, srtpConfig, remotePort);
    attachStream(stream, processorOptions);
    
    return existingTransport;
  }
  
  // Otherwise create a new transport
  const { transport, attachStream } = createT140SrtpTransport(
    remoteAddress,
    srtpConfig,
    remotePort
  );
  
  // Attach the stream to the transport
  const processorOptions: ProcessorOptions = {
    processBackspaces: srtpConfig.processBackspaces,
    handleMetadata: srtpConfig.handleMetadata,
    metadataCallback: srtpConfig.metadataCallback
  };
  
  attachStream(stream, processorOptions);
  
  return transport;
}
