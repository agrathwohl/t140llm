import * as dgram from 'dgram';
import { RtpConfig, TransportStream } from '../interfaces';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { DEFAULT_RTP_PORT } from '../utils/constants';
import { RtpConfigWithSteg } from './rtp-config-extensions';
import { StegTransport } from './steg-transport';

/**
 * Creates a default UDP transport
 */
function createDefaultTransport(
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT
): TransportStream {
  const udpSocket = dgram.createSocket('udp4');

  return {
    send(data: Buffer, callback?: (error?: Error) => void): void {
      udpSocket.send(
        data,
        0,
        data.length,
        remotePort,
        remoteAddress,
        callback ? (err) => callback(err ?? undefined) : undefined
      );
    },
    close(): void {
      udpSocket.close();
    },
  };
}

/**
 * Create an RTP transport with optional steganography support
 *
 * @param remoteAddress The remote IP address to send packets to
 * @param remotePort The remote port to send packets to (default: 5004)
 * @param config RTP configuration with optional steganography settings
 * @returns The configured RTP transport
 */
export function createStegT140RtpTransport(
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  config: RtpConfigWithSteg = {}
): T140RtpTransport {
  // Use the provided transport or create a default UDP transport
  let transport: TransportStream = config.customTransport ||
    createDefaultTransport(remoteAddress, remotePort);

  // If steganography is enabled, wrap the transport with StegTransport
  if (config.steganography?.enabled) {
    transport = new StegTransport(transport, config.steganography);
  }

  // Create a new config with the steganography transport
  const rtpConfig: RtpConfig = {
    ...config,
    customTransport: transport,
  };

  // Create and return the RTP transport
  return new T140RtpTransport(remoteAddress, remotePort, rtpConfig);
}

/**
 * Process an AI stream to RTP with optional steganography
 *
 * This is a wrapper around the regular processAIStreamToRtp function
 * that adds steganography support
 *
 * @param stream The streaming data source
 * @param remoteAddress The remote IP address
 * @param remotePort The remote port (default: 5004)
 * @param config RTP configuration with optional steganography
 * @returns The configured RTP transport
 */
export function processAIStreamToStegRtp(
  stream: any,
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  config: RtpConfigWithSteg = {}
): T140RtpTransport {
  // Import processAIStreamToRtp dynamically to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { processAIStreamToRtp } = require('../processors/process-ai-stream-to-rtp');

  // Create the steganography transport
  const transport = createStegT140RtpTransport(
    remoteAddress,
    remotePort,
    config
  );

  // Process the stream and return the transport
  processAIStreamToRtp(stream, remoteAddress, remotePort, {
    ...config,
    customTransport: transport,
  });

  return transport;
}
