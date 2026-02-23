import { EventEmitter } from 'events';
import { 
  processAIStream,
  processAIStreamToRtp,
  processAIStreamToSrtp,
  processAIStreamToDirectSocket,
  createSrtpKeysFromPassphrase
} from '../src';

/**
 * These are integration-style tests that verify all the processing modes work together properly.
 * We're using our mocked versions of the functions but testing the interactions between them.
 */
describe('Integration Tests', () => {
  let mockAIStream: EventEmitter;
  
  beforeEach(() => {
    // Create a mock AI stream for testing
    mockAIStream = new EventEmitter();
    jest.clearAllMocks();
  });
  
  test('should handle data from all supported AI stream formats', () => {
    // Set up direct socket mode processing
    const socket = processAIStreamToDirectSocket(mockAIStream as any);
    
    // Emit data in different formats
    mockAIStream.emit('data', 'Plain text data');
    mockAIStream.emit('data', { choices: [{ delta: { content: 'Vercel AI format' } }] });
    mockAIStream.emit('data', { choices: [{ text: 'OpenAI format' }] });
    mockAIStream.emit('data', { delta: { text: 'Anthropic format 1' } });
    mockAIStream.emit('data', { content: [{ text: 'Anthropic format 2' }] });
    
    // End the stream
    mockAIStream.emit('end');
    
    // socket.write should be called for each data emission
    expect(socket.write).toHaveBeenCalledTimes(5);
    
    // socket.end should be called once when the stream ends
    expect(socket.end).toHaveBeenCalledTimes(1);
  });
  
  test('should handle different processing modes', () => {
    // Test all the different processing modes
    
    // WebSocket mode
    processAIStream(mockAIStream as any);
    expect(processAIStream).toHaveBeenCalled();
    
    // RTP mode
    const rtpTransport = processAIStreamToRtp(mockAIStream as any, '127.0.0.1');
    expect(processAIStreamToRtp).toHaveBeenCalled();
    expect(rtpTransport).toBeDefined();
    
    // SRTP mode
    const { masterKey, masterSalt } = createSrtpKeysFromPassphrase('test-key');
    const srtpConfig = { masterKey, masterSalt };
    const srtpTransport = processAIStreamToSrtp(mockAIStream as any, '127.0.0.1', 5006, srtpConfig);
    expect(processAIStreamToSrtp).toHaveBeenCalled();
    expect(srtpTransport).toBeDefined();
    
    // Direct socket mode
    const socket = processAIStreamToDirectSocket(mockAIStream as any);
    expect(processAIStreamToDirectSocket).toHaveBeenCalled();
    expect(socket).toBeDefined();
  });
  
  test('direct socket mode should behave similarly to other modes', () => {
    // Set up direct socket mode
    const socket = processAIStreamToDirectSocket(mockAIStream as any);
    
    // Set up RTP mode for comparison
    const rtpTransport = processAIStreamToRtp(mockAIStream as any, '127.0.0.1');
    
    // Emit test data
    mockAIStream.emit('data', 'Test data');
    
    // Both modes should process the data
    expect(socket.write).toHaveBeenCalled();
    expect(rtpTransport.sendText).toHaveBeenCalled();
    
    // Emit end event
    mockAIStream.emit('end');
    
    // Both modes should clean up
    expect(socket.end).toHaveBeenCalled();
    expect(rtpTransport.close).toHaveBeenCalled();
  });
});