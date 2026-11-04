import { ProcessorOptions, RtpConfig, TextDataStream } from '../interfaces';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { toGraphemes } from '../utils/backspace-processing';
import {
  DEFAULT_CHAR_RATE_LIMIT,
  DEFAULT_RTP_PORT,
  IDLE_THRESHOLD_MS,
  MIN_TOKEN_BUCKET_VALUE,
  SEND_INTERVAL_MS,
  TOKEN_REFILL_RATE_DIVISOR,
} from '../utils/constants';
import {
  attachStreamProcessor,
  resolveStreamOptions,
} from '../utils/stream-processor';

/**
 * Attach a stream to an existing T140 RTP transport.
 *
 * Characters are queued and paced by a token bucket at `charRateLimit`
 * characters per second (RFC 4103 §6 "cps", default 30). The first character
 * after an idle period goes out immediately with the M-bit set (RFC 4103 §3,
 * §5.1); the rest drain every SEND_INTERVAL_MS. When the source stream ends,
 * the queue keeps draining at the same rate and the transport closes once it
 * is empty.
 *
 * @param transport The transport to attach the stream to
 * @param stream The stream to attach
 * @param rtpConfig RTP configuration options
 * @param processorOptions Processor options; override the matching rtpConfig fields
 */
export function attachStreamToRtpTransport(
  transport: T140RtpTransport,
  stream: TextDataStream,
  rtpConfig: RtpConfig = {},
  processorOptions: ProcessorOptions = {}
): void {
  const charRateLimit = rtpConfig.charRateLimit || DEFAULT_CHAR_RATE_LIMIT;
  const tokenRefillRate = charRateLimit / TOKEN_REFILL_RATE_DIVISOR;
  const charQueue: string[] = [];
  let tokenBucket = charRateLimit;
  let lastSendTime = Date.now();
  let drainTimer: NodeJS.Timeout | null = null;
  let isIdle = true;
  let idleTimer: NodeJS.Timeout | null = null;
  let closeWhenDrained = false;

  function clearTimers(): void {
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function flushQueue(): void {
    drainTimer = null;

    const now = Date.now();
    tokenBucket = Math.min(charRateLimit, tokenBucket + (now - lastSendTime) * tokenRefillRate);
    lastSendTime = now;

    while (charQueue.length > 0 && tokenBucket >= MIN_TOKEN_BUCKET_VALUE) {
      const charsToSend = Math.min(Math.floor(tokenBucket), charQueue.length);
      const textChunk = charQueue.splice(0, charsToSend).join('');
      if (!textChunk) continue;

      transport.sendText(textChunk, isIdle ? { markerBit: true } : undefined);
      tokenBucket -= textChunk.length;
      if (isIdle) {
        isIdle = false;
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      }
    }

    if (charQueue.length > 0) {
      drainTimer = setTimeout(flushQueue, SEND_INTERVAL_MS);
    } else if (closeWhenDrained) {
      clearTimers();
      transport.close();
    } else {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { isIdle = true; idleTimer = null; }, IDLE_THRESHOLD_MS);
    }
  }

  const options = resolveStreamOptions(processorOptions, {
    processBackspaces: rtpConfig.processBackspaces,
    handleMetadata: rtpConfig.handleMetadata,
    metadataCallback: rtpConfig.metadataCallback,
    onError: rtpConfig.onError,
  });

  attachStreamProcessor(stream, options, {
    sendText: (text, graphemes) => {
      charQueue.push(...(graphemes ?? toGraphemes(text)));
      if (!drainTimer) {
        flushQueue();
      }
    },
    close: () => {
      closeWhenDrained = true;
      if (!drainTimer) {
        flushQueue();
      }
    },
  });
}

/**
 * Create a T140 RTP transport that streams can be attached to later.
 *
 * @param remoteAddress Remote address to send packets to
 * @param remotePort Remote port to send packets to
 * @param rtpConfig RTP configuration options
 * @returns The transport and a function to attach a stream to it
 */
export function createT140RtpTransport(
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  rtpConfig: RtpConfig = {}
): {
  transport: T140RtpTransport;
  attachStream: (
    stream: TextDataStream,
    processorOptions?: ProcessorOptions
  ) => void;
} {
  const transport = new T140RtpTransport(remoteAddress, remotePort, rtpConfig);

  if (rtpConfig.bomPrewarm) {
    // A zero-width no-break space opens NAT pinholes before the first real character.
    transport.sendText('﻿', { markerBit: true });
  }

  return {
    transport,
    attachStream: (stream, processorOptions = {}) => {
      attachStreamToRtpTransport(transport, stream, rtpConfig, processorOptions);
    },
  };
}

/**
 * Stream an LLM response as T.140 over RTP.
 *
 * @param stream The AI stream to process
 * @param remoteAddress Remote address to send packets to
 * @param remotePort Remote port to send packets to (default 5004)
 * @param rtpConfig Configuration options including custom transport
 * @param existingTransport Optional existing T140RtpTransport to use
 * @returns T140RtpTransport instance
 */
export function processAIStreamToRtp(
  stream: TextDataStream,
  remoteAddress: string,
  remotePort: number = DEFAULT_RTP_PORT,
  rtpConfig: RtpConfig = {},
  existingTransport?: T140RtpTransport
): T140RtpTransport {
  if (existingTransport) {
    attachStreamToRtpTransport(existingTransport, stream, rtpConfig);
    return existingTransport;
  }

  const { transport, attachStream } = createT140RtpTransport(remoteAddress, remotePort, rtpConfig);
  attachStream(stream);
  return transport;
}
