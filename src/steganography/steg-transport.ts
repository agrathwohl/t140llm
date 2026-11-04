import { LSBAlgorithm, StegEngine } from '@agrathwohl/llm-steg';
import { randomBytes } from 'crypto';
import createDebug from 'debug';
import { TransportStream } from '../interfaces';
import { StegConfig } from './steg-config.interface';
import { StegTransportInterface } from './steg-transport.interface';

const debug = createDebug('t140llm:steg');

/**
 * Transport wrapper that hides each outgoing RTP packet inside cover media.
 *
 * Encoding and decoding are done by @agrathwohl/llm-steg, an optional
 * dependency. Install it before importing this module:
 * https://github.com/agrathwohl/llm-steg
 *
 * Steganography is obfuscation, not confidentiality. Combine it with SRTP when
 * the text must stay secret.
 */
export class StegTransport implements StegTransportInterface {
  private readonly innerTransport: TransportStream;
  private readonly engine: StegEngine;
  private config: StegConfig;

  /**
   * @param innerTransport The transport that sends the encoded packets
   * @param config Steganography settings
   */
  constructor(innerTransport: TransportStream, config: StegConfig = {}) {
    if ((config.encodeMode as string) === 'llm') {
      throw new Error(
        'LLM encode mode was removed: it evaluated generated code at runtime. ' +
        'Use the default \'lsb\' algorithm instead.'
      );
    }

    this.innerTransport = innerTransport;
    this.config = {
      ...config,
      enabled: config.enabled ?? true,
      algorithm: config.algorithm ?? 'lsb',
      coverMedia: config.coverMedia ?? [],
      seed: config.seed ?? randomBytes(16).toString('hex'),
      onError: config.onError ?? 'throw',
      encodeMode: 'fixed',
    };

    this.engine = new StegEngine({
      enabled: this.config.enabled,
      algorithm: this.config.algorithm,
      coverMedia: this.config.coverMedia,
      seed: this.config.seed,
      onError: this.config.onError,
      debug: this.config.debug,
    });
    // StegEngine is an EventEmitter that emits 'error' on a failed encode.
    // Without a listener Node would treat it as an unhandled error and exit.
    // send() reports the failure through its callback, so log it here.
    this.engine.on('error', (event: { type: string; error: Error }) => {
      debug('%s failed: %s', event.type, event.error.message);
    });
    this.engine.setAlgorithm(new LSBAlgorithm({ seed: this.config.seed }));
  }

  /**
   * Hide the packet in the next cover buffer and send it.
   *
   * With no cover media, or with `enabled: false`, the packet is sent as is.
   * A failed encode follows the `onError` setting: 'throw' and the default
   * report the error through `callback`, 'passthrough' sends the packet
   * unhidden, 'drop' discards it. This method never throws, because the RTP
   * send path calls it from a timer.
   */
  public send(data: Buffer, callback?: (error?: Error) => void): void {
    if (!this.config.enabled || !this.config.coverMedia?.length) {
      this.innerTransport.send(data, callback);
      return;
    }

    let encoded;
    try {
      encoded = this.engine.encode(data);
    } catch (err) {
      // onError: 'throw' makes the engine throw rather than return a result.
      callback?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (!encoded.success && this.config.onError === 'drop') {
      callback?.();
      return;
    }

    this.innerTransport.send(encoded.data, callback);
  }

  /** Close the inner transport. */
  public close(): void {
    this.innerTransport.close?.();
  }

  /**
   * Hide `data` in a specific cover buffer.
   *
   * @throws Error when the cover is too small for the data
   */
  public encode(data: Buffer, cover: Buffer): Buffer {
    const algorithm = this.engine.getAlgorithm();
    if (!algorithm) {
      throw new Error('No steganography algorithm is set');
    }
    return algorithm.encode(data, cover);
  }

  /**
   * Recover hidden data from an encoded buffer.
   *
   * @throws Error when the buffer holds no valid hidden payload
   */
  public decode(stegData: Buffer): Buffer {
    const result = this.engine.decode(stegData);
    if (!result.success) {
      throw new Error(result.error ?? 'Steganographic decoding failed');
    }
    return result.data;
  }

  /** The current configuration. */
  public getConfig(): StegConfig {
    return { ...this.config };
  }

  /** Change the configuration. Cover media and seed take effect immediately. */
  public updateConfig(config: Partial<StegConfig>): void {
    if ((config.encodeMode as string) === 'llm') {
      throw new Error(
        'LLM encode mode was removed: it evaluated generated code at runtime. ' +
        'Use the default \'lsb\' algorithm instead.'
      );
    }

    this.config = { ...this.config, ...config };
    this.engine.updateConfig({
      enabled: this.config.enabled,
      coverMedia: this.config.coverMedia,
      seed: this.config.seed,
      onError: this.config.onError,
      debug: this.config.debug,
    });
  }
}
