import { ProcessorOptions, RtpConfig, TextDataStream } from '../interfaces';
import { T140RtpMultiplexer } from '../rtp/t140-rtp-multiplexer';
import { DEFAULT_RTP_PORT } from '../utils/constants';

/**
 * Create a multiplexer that can handle multiple LLM streams
 * and send them over a single RTP connection
 *
 * @param remoteAddress Remote address to send multiplexed packets to
 * @param remotePort Remote port to send multiplexed packets to
 * @param multiplexConfig Multiplexer configuration options
 * @returns The multiplexer instance
 */
export function createT140RtpMultiplexer(
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  multiplexConfig: RtpConfig = {}
): T140RtpMultiplexer {
  return new T140RtpMultiplexer(remoteAddress, remotePort, multiplexConfig);
}

/**
 * Process multiple AI streams and multiplex them into a single RTP output
 *
 * @param streams Map of stream IDs to TextDataStream instances
 * @param remoteAddress Remote address to send packets to
 * @param remotePort Remote port to send packets to
 * @param multiplexConfig Multiplexer configuration options
 * @returns The T140RtpMultiplexer instance
 */
export function processAIStreamsToMultiplexedRtp(
  streams: Map<string, TextDataStream>,
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  multiplexConfig: RtpConfig = {},
  processorOptions: ProcessorOptions = {}
): T140RtpMultiplexer {
  // Create the multiplexer
  const multiplexer = createT140RtpMultiplexer(
    remoteAddress,
    remotePort,
    multiplexConfig
  );

  // Add each stream to the multiplexer
  for (const [id, stream] of streams.entries()) {
    multiplexer.addStream(id, stream, {}, processorOptions);
  }

  return multiplexer;
}

/**
 * Add a new AI stream to an existing multiplexer
 *
 * @param multiplexer The existing multiplexer
 * @param id Unique ID for this stream
 * @param stream The stream to add
 * @param streamConfig Optional configuration specific to this stream
 * @param processorOptions Optional processor options for this stream
 * @returns True if the stream was added successfully
 */
export function addAIStreamToMultiplexer(
  multiplexer: T140RtpMultiplexer,
  id: string,
  stream: TextDataStream,
  streamConfig: RtpConfig = {},
  processorOptions: ProcessorOptions = {}
): boolean {
  return multiplexer.addStream(id, stream, streamConfig, processorOptions);
}
