// Example demonstrating T.140 backspace support
const { 
  processAIStreamToRtp, 
  processAIStreamToDirectSocket, 
  BACKSPACE
} = require('../dist/index.js');
const EventEmitter = require('events');

// Create a mock stream with backspaces
class MockStream extends EventEmitter {
  start() {
    // Simulate typing "Hello", then backspace to fix a typo, then continue
    setTimeout(() => this.emit('data', 'Hel'), 100);
    setTimeout(() => this.emit('data', 'lo '), 300);
    setTimeout(() => this.emit('data', 'worl'), 500);
    setTimeout(() => this.emit('data', 'd' + BACKSPACE + BACKSPACE), 700); // Use backspaces
    setTimeout(() => this.emit('data', 'ld!'), 900);
    setTimeout(() => this.emit('end'), 1100);
  }
}

// Create a mock stream
const stream = new MockStream();

// Example 1: Using RTP with backspace processing enabled
console.log('Example 1: Using RTP with backspace processing');
const transport = processAIStreamToRtp(
  stream, 
  '127.0.0.1', 
  5004, 
  {
    processBackspaces: true,
    // Other config options can be added here
  }
);

// Start the stream
stream.start();

// The final result should be "Hello world!" (with the 'd' corrected to 'ld')
console.log('Backspace processing is now enabled. You should see "Hello world!" in your T.140 client.');
console.log('Without backspace processing, you would see something like "Hello worl' + BACKSPACE + BACKSPACE + 'ld!"');