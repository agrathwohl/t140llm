import { ProcessorOptions, RtpConfig, TextDataStream } from '../interfaces';
import { DtlsSrtpOptions, DtlsSrtpSession, negotiateDtlsSrtp } from '../rtp/dtls-srtp';
import { T140RtpTransport } from '../rtp/t140-rtp-transport';
import { DEFAULT_SRTP_PORT } from '../utils/constants';
import { attachStreamToRtpTransport } from './process-ai-stream-to-rtp';

/** RTP options plus the DTLS-SRTP handshake settings. */
export type DtlsSrtpConfig = Omit<RtpConfig, 'customTransport'> & {
  dtls?: DtlsSrtpOptions;
};

/**
 * Create a T140 SRTP transport whose keys come from a DTLS-SRTP handshake
 * (RFC 5764), rather than keys you manage yourself.
 * https://www.rfc-editor.org/rfc/rfc5764
 *
 * The handshake runs first, so this function is async. The DTLS session and
 * the SRTP media share one UDP 5-tuple.
 *
 * @param remoteAddress Peer address
 * @param remotePort Peer port, default 5006
 * @param config RTP options, plus `dtls` for role, certificate, and profiles
 * @returns The transport, a function to attach a stream, and the DTLS session
 */
export async function createT140DtlsSrtpTransport(
  remoteAddress: string,
  remotePort: number = DEFAULT_SRTP_PORT,
  config: DtlsSrtpConfig = {}
): Promise<{
  transport: T140RtpTransport;
  attachStream: (
    stream: TextDataStream,
    processorOptions?: ProcessorOptions
  ) => void;
  session: DtlsSrtpSession;
}> {
  const session = await negotiateDtlsSrtp(remoteAddress, remotePort, config.dtls);

  const transport = new T140RtpTransport(remoteAddress, remotePort, {
    ...config,
    customTransport: session.transport,
  });

  try {
    transport.setupSrtp({
      masterKey: session.masterKey,
      masterSalt: session.masterSalt,
      remoteMasterKey: session.remoteMasterKey,
      remoteMasterSalt: session.remoteMasterSalt,
      profile: session.profile,
    });
  } catch (err) {
    session.close();
    throw err;
  }

  if (config.bomPrewarm) {
    // A zero-width no-break space opens NAT pinholes before the first character.
    transport.sendText('﻿', { markerBit: true });
  }

  return {
    transport,
    session,
    attachStream: (stream, processorOptions = {}) => {
      attachStreamToRtpTransport(transport, stream, config, processorOptions);
    },
  };
}

/**
 * Stream an LLM response as T.140 over SRTP, with keys from a DTLS-SRTP
 * handshake (RFC 5764). No key material to manage.
 *
 * @param stream The AI stream to process
 * @param remoteAddress Peer address
 * @param remotePort Peer port, default 5006
 * @param config RTP options, plus `dtls` for role, certificate, and profiles
 * @returns The transport, after the handshake completes
 */
export async function processAIStreamToDtlsSrtp(
  stream: TextDataStream,
  remoteAddress: string,
  remotePort: number = DEFAULT_SRTP_PORT,
  config: DtlsSrtpConfig = {}
): Promise<T140RtpTransport> {
  const { transport, attachStream } = await createT140DtlsSrtpTransport(
    remoteAddress,
    remotePort,
    config
  );
  attachStream(stream);
  return transport;
}
