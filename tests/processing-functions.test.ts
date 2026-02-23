import { 
  processAIStream, 
  processAIStreamToRtp, 
  processAIStreamToSrtp,
  processAIStreamToDirectSocket,
  createSrtpKeysFromPassphrase
} from '../src';
import { EventEmitter } from 'events';

describe('Processing Functions', () => {
  let mockStream: EventEmitter;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create a mock AI stream
    mockStream = new EventEmitter();
  });
  
  describe('processAIStream (WebSocket mode)', () => {
    test('is a function', () => {
      expect(typeof processAIStream).toBe('function');
      
      // Verify it can be called with the expected parameters
      processAIStream(mockStream as any, 'ws://example.com:9999');
      
      // Since we're using a mock, just verify the function was called
      expect(processAIStream).toHaveBeenCalled();
    });
  });
  
  describe('processAIStreamToRtp', () => {
    test('is a function', () => {
      expect(typeof processAIStreamToRtp).toBe('function');
      
      // Verify it can be called with the expected parameters
      const transport = processAIStreamToRtp(mockStream as any, '127.0.0.1', 5004);
      
      // Verify we got a transport object back
      expect(transport).toBeDefined();
      expect(transport.remoteAddress).toBe('127.0.0.1');
      expect(transport.remotePort).toBe(5004);
    });
  });
  
  describe('processAIStreamToSrtp', () => {
    test('is a function', () => {
      expect(typeof processAIStreamToSrtp).toBe('function');
      
      // Create mock SRTP config
      const srtpConfig = {
        masterKey: Buffer.from('test-key'),
        masterSalt: Buffer.from('test-salt')
      };
      
      // Verify it can be called with the expected parameters
      const transport = processAIStreamToSrtp(mockStream as any, '127.0.0.1', 5006, srtpConfig);
      
      // Verify we got a transport object back
      expect(transport).toBeDefined();
      expect(transport.remoteAddress).toBe('127.0.0.1');
      expect(transport.remotePort).toBe(5006);
    });
  });
  
  describe('processAIStreamToDirectSocket', () => {
    test('is a function', () => {
      expect(typeof processAIStreamToDirectSocket).toBe('function');
      
      // Verify it can be called with the expected parameters
      const socket = processAIStreamToDirectSocket(mockStream as any, '/test/socket/path');
      
      // Verify we got a socket object back with the expected methods
      expect(socket).toBeDefined();
      expect(socket.write).toBeDefined();
      expect(socket.end).toBeDefined();
      expect(typeof socket.write).toBe('function');
      expect(typeof socket.end).toBe('function');
    });
  });
  
  describe('createSrtpKeysFromPassphrase', () => {
    test('generates keys and salt from passphrase', () => {
      const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('test-passphrase');
      
      // Verify the buffers have the correct lengths
      expect(Buffer.isBuffer(masterKey)).toBe(true);
      expect(Buffer.isBuffer(masterSalt)).toBe(true);
      expect(masterKey.length).toBe(16); // 128 bits
      expect(masterSalt.length).toBe(14); // 112 bits
    });
  });
});