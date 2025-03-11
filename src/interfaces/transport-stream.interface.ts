/**
 * Interface for custom transport implementations that can be used
 * as alternatives to the default UDP socket in T140RtpTransport
 */
export interface TransportStream {
  /**
   * Send data through the transport
   * @param data The packet data to send
   * @param callback Optional callback called when the data has been sent or if an error occurred
   */
  send(data: Buffer, callback?: (error?: Error) => void): void;

  /**
   * Optional method to close the transport and clean up resources
   */
  close?(): void;
}
