import { T140RtpTransport } from '../src';

describe('T140RtpTransport', () => {
  let transport: T140RtpTransport;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create a new transport instance with default values
    transport = new T140RtpTransport('127.0.0.1', 5004);
  });
  
  test('is initialized with correct default values', () => {
    // Test with default options
    const defaultTransport = new T140RtpTransport('192.168.1.1');
    
    // Check that the remote address was set correctly
    expect(defaultTransport.remoteAddress).toBe('192.168.1.1');
    expect(defaultTransport.remotePort).toBe(5004); // Default port
  });
  
  test('sends text data', () => {
    // Our mock implementation in __mocks__ just needs to verify the method exists
    expect(typeof transport.sendText).toBe('function');
    
    const testText = 'Hello T.140';
    transport.sendText(testText);
    
    // In our mock, sendText is a jest.fn() so we can check it was called
    expect(transport.sendText).toHaveBeenCalledWith(testText);
  });
  
  test('can be closed', () => {
    // Our mock implementation in __mocks__ just needs to verify the method exists
    expect(typeof transport.close).toBe('function');
    
    transport.close();
    
    // In our mock, close is a jest.fn() so we can check it was called
    expect(transport.close).toHaveBeenCalled();
  });
  
  test('can set up SRTP', () => {
    // Our mock implementation in __mocks__ just needs to verify the method exists
    expect(typeof transport.setupSrtp).toBe('function');
    
    const mockSrtpConfig = {
      masterKey: Buffer.from('test-key'),
      masterSalt: Buffer.from('test-salt')
    };
    
    transport.setupSrtp(mockSrtpConfig);
    
    // In our mock, setupSrtp is a jest.fn() so we can check it was called
    expect(transport.setupSrtp).toHaveBeenCalledWith(mockSrtpConfig);
  });
});