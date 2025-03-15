/**
 * Example showing how to transcode T140 text to Baudot/TTY format
 * 
 * This example demonstrates how to use the T140 library as an intermediary
 * between an LLM text stream and a Baudot/TTY telegraph machine or analog
 * telephone line that uses 5-bit Baudot/ITA2 encoding.
 */

const { processAIStreamToRtp, T140RtpTransport } = require('../dist');
const { EventEmitter } = require('events');

/**
 * Base class for Baudot codecs (for different telegraph alphabets)
 */
class BaseBaudotCodec {
  constructor() {
    // Control codes (common between variants)
    this.LTRS = 0x1F; // Letters shift
    this.FIGS = 0x1B; // Figures shift
    this.CR = 0x02;   // Carriage return
    this.LF = 0x08;   // Line feed
    
    this.currentShift = this.LTRS; // Start in LETTERS mode
    
    // These must be implemented by subclasses
    this.letterShift = {};
    this.figureShift = {};
  }
  
  /**
   * Convert ASCII text to Baudot/TTY codes
   * Returns an array of 5-bit codes with shift characters inserted as needed
   */
  encode(text) {
    if (!text) return [];
    
    const result = [];
    let prevShift = this.currentShift;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i].toUpperCase();
      
      // Handle line breaks
      if (char === '\n' || char === '\r') {
        result.push(this.CR);
        result.push(this.LF);
        continue;
      }
      
      // Check if character is in letter shift table
      if (this.letterShift[char] !== undefined) {
        // Switch to LETTERS if needed
        if (prevShift !== this.LTRS) {
          result.push(this.LTRS);
          prevShift = this.LTRS;
        }
        result.push(this.letterShift[char]);
      }
      // Check if character is in figure shift table
      else if (this.figureShift[char] !== undefined) {
        // Switch to FIGURES if needed
        if (prevShift !== this.FIGS) {
          result.push(this.FIGS);
          prevShift = this.FIGS;
        }
        result.push(this.figureShift[char]);
      }
      // Unsupported character - ignore or replace
      else {
        // Replace unsupported characters with space
        if (prevShift !== this.LTRS) {
          result.push(this.LTRS);
          prevShift = this.LTRS;
        }
        result.push(this.letterShift[' ']);
      }
    }
    
    // Update current shift state
    this.currentShift = prevShift;
    
    return result;
  }
  
  /**
   * Convert Baudot/TTY codes back to ASCII text
   * Handles shift characters appropriately
   */
  decode(baudotCodes) {
    if (!baudotCodes || !baudotCodes.length) return '';
    
    let result = '';
    let shift = this.LTRS; // Start in LETTERS mode
    
    for (let i = 0; i < baudotCodes.length; i++) {
      const code = baudotCodes[i];
      
      // Handle shift codes
      if (code === this.LTRS) {
        shift = this.LTRS;
        continue;
      }
      else if (code === this.FIGS) {
        shift = this.FIGS;
        continue;
      }
      
      // Handle carriage return and line feed
      if (code === this.CR) {
        // Skip CR, will be handled by LF
        continue;
      }
      else if (code === this.LF) {
        result += '\n';
        continue;
      }
      
      // Convert code to character based on current shift
      if (shift === this.LTRS) {
        // Find the character for this code in letter shift
        for (const [char, charCode] of Object.entries(this.letterShift)) {
          if (charCode === code) {
            result += char;
            break;
          }
        }
      } else {
        // Find the character for this code in figure shift
        for (const [char, charCode] of Object.entries(this.figureShift)) {
          if (charCode === code) {
            result += char;
            break;
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * Format Baudot codes as a binary string for debugging
   */
  formatBaudotCodes(codes) {
    return codes.map(code => {
      const binary = code.toString(2).padStart(5, '0');
      return binary;
    }).join(' ');
  }
}

/**
 * ITA2 (International Telegraph Alphabet No. 2) implementation
 * This is a 5-bit code used by TTY/TDD devices and old telegraph systems
 */
class ITA2Codec extends BaseBaudotCodec {
  constructor() {
    super();
    
    // ITA2 Baudot code tables (International standard)
    this.letterShift = {
      ' ': 0x04, // Space
      'E': 0x01, 'A': 0x03, 'S': 0x05, 'I': 0x09, 'U': 0x0D,
      'D': 0x11, 'R': 0x0A, 'J': 0x06, 'N': 0x07, 'F': 0x0E,
      'C': 0x0F, 'K': 0x0B, 'T': 0x10, 'Z': 0x12, 'L': 0x14,
      'W': 0x13, 'H': 0x08, 'Y': 0x18, 'P': 0x16, 'Q': 0x17,
      'O': 0x19, 'B': 0x0C, 'G': 0x15, 'M': 0x1A, 'X': 0x1B,
      'V': 0x1C
    };

    this.figureShift = {
      ' ': 0x04, // Space
      '3': 0x01, '-': 0x03, "'": 0x05, '8': 0x09, '7': 0x0D,
      'ENQ': 0x11, '4': 0x0A, '\u0007': 0x06, // BELL
      ',': 0x07, '!': 0x0E,
      ':': 0x0F, '(': 0x0B, '5': 0x10, '+': 0x12, ')': 0x14,
      '2': 0x13, '£': 0x08, '6': 0x18, '0': 0x16, '1': 0x17,
      '9': 0x19, '?': 0x0C, '&': 0x15, '.': 0x1A, '/': 0x1B,
      '=': 0x1C
    };
  }
}

/**
 * US-TTY Baudot/ITA2 variant implementation
 * This is the American variant used in TTY/TDD devices
 */
class USTTYCodec extends BaseBaudotCodec {
  constructor() {
    super();
    
    // US-TTY Baudot code tables (5-bit encoding)
    this.letterShift = {
      ' ': 0x04, // Space
      'E': 0x01, 'A': 0x03, 'S': 0x05, 'I': 0x09, 'U': 0x0D,
      'D': 0x11, 'R': 0x0A, 'J': 0x06, 'N': 0x07, 'F': 0x0E,
      'C': 0x0F, 'K': 0x0B, 'T': 0x10, 'Z': 0x12, 'L': 0x14,
      'W': 0x13, 'H': 0x08, 'Y': 0x18, 'P': 0x16, 'Q': 0x17,
      'O': 0x19, 'B': 0x0C, 'G': 0x15, 'M': 0x1A, 'X': 0x1B,
      'V': 0x1C
    };

    this.figureShift = {
      ' ': 0x04, // Space
      '3': 0x01, '-': 0x03, "'": 0x05, '8': 0x09, '7': 0x0D,
      '$': 0x11, '4': 0x0A, '\u0007': 0x06, // BELL
      ',': 0x07, '!': 0x0E,
      ':': 0x0F, '(': 0x0B, '5': 0x10, '+': 0x12, ')': 0x14,
      '2': 0x13, '#': 0x08, '6': 0x18, '0': 0x16, '1': 0x17,
      '9': 0x19, '?': 0x0C, '&': 0x15, '.': 0x1A, '/': 0x1B,
      ';': 0x1C
    };
  }

  /**
   * Convert ASCII text to Baudot/TTY codes
   * Returns an array of 5-bit codes with shift characters inserted as needed
   */
  encode(text) {
    if (!text) return [];
    
    const result = [];
    let prevShift = this.currentShift;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i].toUpperCase();
      
      // Handle line breaks
      if (char === '\n' || char === '\r') {
        result.push(this.CR);
        result.push(this.LF);
        continue;
      }
      
      // Check if character is in letter shift table
      if (this.letterShift[char] !== undefined) {
        // Switch to LETTERS if needed
        if (prevShift !== this.LTRS) {
          result.push(this.LTRS);
          prevShift = this.LTRS;
        }
        result.push(this.letterShift[char]);
      }
      // Check if character is in figure shift table
      else if (this.figureShift[char] !== undefined) {
        // Switch to FIGURES if needed
        if (prevShift !== this.FIGS) {
          result.push(this.FIGS);
          prevShift = this.FIGS;
        }
        result.push(this.figureShift[char]);
      }
      // Unsupported character - ignore or replace
      else {
        // Replace unsupported characters with space
        if (prevShift !== this.LTRS) {
          result.push(this.LTRS);
          prevShift = this.LTRS;
        }
        result.push(this.letterShift[' ']);
      }
    }
    
    // Update current shift state
    this.currentShift = prevShift;
    
    return result;
  }
  
  /**
   * Convert Baudot/TTY codes back to ASCII text
   * Handles shift characters appropriately
   */
  decode(baudotCodes) {
    if (!baudotCodes || !baudotCodes.length) return '';
    
    let result = '';
    let shift = this.LTRS; // Start in LETTERS mode
    
    for (let i = 0; i < baudotCodes.length; i++) {
      const code = baudotCodes[i];
      
      // Handle shift codes
      if (code === this.LTRS) {
        shift = this.LTRS;
        continue;
      }
      else if (code === this.FIGS) {
        shift = this.FIGS;
        continue;
      }
      
      // Handle carriage return and line feed
      if (code === this.CR) {
        // Skip CR, will be handled by LF
        continue;
      }
      else if (code === this.LF) {
        result += '\n';
        continue;
      }
      
      // Convert code to character based on current shift
      if (shift === this.LTRS) {
        // Find the character for this code in letter shift
        for (const [char, charCode] of Object.entries(this.letterShift)) {
          if (charCode === code) {
            result += char;
            break;
          }
        }
      } else {
        // Find the character for this code in figure shift
        for (const [char, charCode] of Object.entries(this.figureShift)) {
          if (charCode === code) {
            result += char;
            break;
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * Format Baudot codes as a binary string for debugging
   */
  formatBaudotCodes(codes) {
    return codes.map(code => {
      const binary = code.toString(2).padStart(5, '0');
      return binary;
    }).join(' ');
  }
}

/**
 * A custom transport that converts text to Baudot/TTY codes
 * This would typically interface with hardware to send the codes
 * to a real TTY device or over a telephone line
 */
class BaudotTTYTransport {
  constructor(options = {}) {
    this.name = options.name || 'BaudotTTYTransport';
    // Choose the appropriate codec based on options
    if (options.codecType === 'ita2') {
      this.baudotCodec = new ITA2Codec();
      console.log(`[${this.name}] Using ITA2 (International) codec`);
    } else {
      this.baudotCodec = new USTTYCodec();
      console.log(`[${this.name}] Using US-TTY codec`);
    }
    this.packetCount = 0;
    this.totalBytes = 0;
    this.baudRate = options.baudRate || 45.45; // Standard Baudot speed (45.45 baud)
    this.serialOutput = options.serialOutput || false; // Whether to simulate serial output timing
    
    console.log(`[${this.name}] Created Baudot/TTY transport (${this.baudRate} baud)`);
  }
  
  /**
   * Send method required by the TransportStream interface
   * Converts T.140 text to Baudot/TTY codes
   */
  send(data, callback) {
    this.packetCount++;
    this.totalBytes += data.length;
    
    // Log packet info
    console.log(`[${this.name}] Packet #${this.packetCount}: ${data.length} bytes`);
    
    // Get the text payload (skip the 12-byte RTP header)
    if (data.length > 12) {
      const payload = data.slice(12).toString('utf8');
      console.log(`[${this.name}] T.140 Payload: "${payload}"`);
      
      // Convert to Baudot/TTY codes
      const baudotCodes = this.baudotCodec.encode(payload);
      const baudotBinary = this.baudotCodec.formatBaudotCodes(baudotCodes);
      
      console.log(`[${this.name}] Baudot Codes: ${baudotBinary}`);
      
      // If serialOutput is enabled, simulate baudot output timing
      if (this.serialOutput && baudotCodes.length > 0) {
        this.simulateSerialOutput(baudotCodes);
      }
    }
    
    // Call the callback with no error
    if (callback) {
      callback();
    }
  }
  
  /**
   * Simulate serial output timing based on baud rate
   * This demonstrates how the codes would be sent to a real device
   */
  simulateSerialOutput(baudotCodes) {
    const bitDuration = 1000 / this.baudRate; // ms per bit
    
    console.log(`[${this.name}] Simulating serial output at ${this.baudRate} baud...`);
    
    // For each baudot code (5 bits + start/stop bits = 7 bits per character)
    let totalTime = 0;
    for (let i = 0; i < baudotCodes.length; i++) {
      const code = baudotCodes[i];
      const charTime = 7 * bitDuration; // 7 bits per character (5 data + start + stop)
      totalTime += charTime;
      
      // Log timing info for the first few characters
      if (i < 5) {
        console.log(`[${this.name}] Char ${i+1}: ${code.toString(2).padStart(5, '0')} (${Math.round(charTime)}ms)`);
      }
    }
    
    console.log(`[${this.name}] Transmission would take approximately ${Math.round(totalTime)}ms at ${this.baudRate} baud`);
  }
  
  /**
   * Close method (optional in the TransportStream interface)
   */
  close() {
    console.log(`[${this.name}] Transport closed. Stats: ${this.packetCount} packets, ${this.totalBytes} bytes total`);
  }
}

/**
 * Create a simple mock AI stream for demonstration purposes
 */
function createMockAIStream() {
  const emitter = new EventEmitter();
  
  // Simulate stream data events with longer content to demonstrate TTY transmission
  const messages = [
    "HELLO STOP ",
    "THIS IS A TEST ",
    "OF THE EMERGENCY ",
    "BROADCAST SYSTEM STOP ",
    "TTY MACHINES ",
    "TYPICALLY OPERATE ",
    "AT 45.45 BAUD ",
    "WHICH IS QUITE SLOW ",
    "BY TODAY'S STANDARDS STOP"
  ];
  
  let index = 0;
  const interval = setInterval(() => {
    if (index < messages.length) {
      emitter.emit('data', messages[index]);
      index++;
    } else {
      emitter.emit('end');
      clearInterval(interval);
    }
  }, 1000);
  
  return emitter;
}

/**
 * Example using T140RtpTransport with the BaudotTTYTransport to send
 * text to a simulated TTY device
 */
function directExample() {
  console.log("\n=== Baudot/TTY Example with T140RtpTransport ===\n");

  // Create a US-TTY transport
  const usTtyTransport = new BaudotTTYTransport({
    name: "USTTYExample",
    baudRate: 45.45,
    serialOutput: true
  });
  
  // Create a T140RtpTransport with the US-TTY transport
  const usTransport = new T140RtpTransport(
    "dummy-address", // Not used with custom transport
    5004,            // Not used with custom transport
    {
      customTransport: usTtyTransport,
      payloadType: 96,
      redEnabled: false // Disable redundancy for simplicity
    }
  );
  
  // Send some text with US-TTY
  usTransport.sendText("CALLING KH6BB DE K6BP");
  usTransport.sendText("PSE K");
  
  // Create an ITA2 transport (international variant)
  const ita2Transport = new BaudotTTYTransport({
    name: "ITA2Example",
    baudRate: 50.0, // ITA2 often operated at 50 baud in Europe
    serialOutput: true,
    codecType: 'ita2'
  });
  
  // Create a second T140RtpTransport with the ITA2 transport
  const internationalTransport = new T140RtpTransport(
    "dummy-address", 
    5005,          
    {
      customTransport: ita2Transport,
      payloadType: 96,
      redEnabled: false
    }
  );
  
  // Send some text with ITA2 (international)
  internationalTransport.sendText("CQ CQ CQ DE G4ABC");
  internationalTransport.sendText("PSE K");
  
  // Close the transports
  setTimeout(() => {
    usTransport.close();
    internationalTransport.close();
  }, 2000);
}

/**
 * Example using processAIStreamToRtp with BaudotTTYTransport
 * to stream AI responses as Baudot codes
 */
function streamExample() {
  console.log("\n=== Baudot/TTY Example with AI Stream ===\n");

  // Create a mock AI stream for US-TTY
  const usStream = createMockAIStream();
  
  // Create a US-TTY transport
  const usTtyTransport = new BaudotTTYTransport({
    name: "USTTYStreamExample",
    baudRate: 45.45,
    serialOutput: true
  });
  
  // Process the stream with the US-TTY transport
  const usTransport = processAIStreamToRtp(
    usStream,
    "dummy-address", // Not used with custom transport
    5004,            // Not used with custom transport
    {
      customTransport: usTtyTransport,
      payloadType: 96
    }
  );
  
  // Create a second mock AI stream for ITA2
  const ita2Stream = createMockAIStream();
  
  // Create an ITA2 transport
  const ita2Transport = new BaudotTTYTransport({
    name: "ITA2StreamExample",
    baudRate: 50.0,
    serialOutput: true,
    codecType: 'ita2'
  });
  
  // Process the stream with the ITA2 transport
  const internationalTransport = processAIStreamToRtp(
    ita2Stream,
    "dummy-address",
    5005,
    {
      customTransport: ita2Transport,
      payloadType: 96
    }
  );
  
  // The transports will be closed automatically when the streams end
  usStream.on('end', () => {
    console.log("\n=== US-TTY Stream ended, transmission complete ===\n");
    
    // Demonstrate decoding US-TTY Baudot back to ASCII
    const usTtyCodec = new USTTYCodec();
    
    // Example Baudot codes (HELLO)
    const baudotCodes = [
      usTtyCodec.LTRS,
      usTtyCodec.letterShift['H'],
      usTtyCodec.letterShift['E'],
      usTtyCodec.letterShift['L'],
      usTtyCodec.letterShift['L'],
      usTtyCodec.letterShift['O']
    ];
    
    const decoded = usTtyCodec.decode(baudotCodes);
    console.log(`[US-TTY Test] Decoded Baudot: ${decoded}`);
  });
  
  ita2Stream.on('end', () => {
    console.log("\n=== ITA2 Stream ended, transmission complete ===\n");
    
    // Demonstrate decoding ITA2 Baudot back to ASCII
    const ita2Codec = new ITA2Codec();
    
    // Example Baudot codes (HELLO)
    const baudotCodes = [
      ita2Codec.LTRS,
      ita2Codec.letterShift['H'],
      ita2Codec.letterShift['E'],
      ita2Codec.letterShift['L'],
      ita2Codec.letterShift['L'],
      ita2Codec.letterShift['O']
    ];
    
    // Demonstrate figures shift (numbers) with ITA2
    const numberCodes = [
      ita2Codec.FIGS,
      ita2Codec.figureShift['1'],
      ita2Codec.figureShift['2'],
      ita2Codec.figureShift['3'],
      ita2Codec.LTRS,
      ita2Codec.letterShift['A'],
      ita2Codec.letterShift['B'],
      ita2Codec.letterShift['C']
    ];
    
    const decodedText = ita2Codec.decode(baudotCodes);
    const decodedNumbers = ita2Codec.decode(numberCodes);
    console.log(`[ITA2 Test] Decoded Letters: ${decodedText}`);
    console.log(`[ITA2 Test] Decoded Mixed: ${decodedNumbers}`);
    
    // Show difference between ITA2 and US-TTY in figure shift
    console.log(`\n=== Comparing ITA2 vs US-TTY Encodings ===`);
    console.log(`ITA2 uses '£' for 0x08 in FIGS, US-TTY uses '#'`);
    console.log(`ITA2 uses '=' for 0x1C in FIGS, US-TTY uses ';'`);
  });
}

// Run the examples
directExample();
setTimeout(streamExample, 3000);