import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import { negotiateDtlsSrtp } from '../src/rtp/dtls-srtp';
import { T140RtpTransport } from '../src/rtp/t140-rtp-transport';
import { createT140DtlsSrtpTransport } from '../src/processors/process-ai-stream-to-dtls-srtp';

/** Bind a UDP socket on an ephemeral loopback port and return it with its port. */
async function boundSocket(): Promise<{ socket: dgram.Socket; port: number }> {
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', () => resolve()));
  return { socket, port: (socket.address() as dgram.AddressInfo).port };
}

describe('DTLS-SRTP key management (RFC 5764)', () => {
  jest.setTimeout(30000);

  it('derives matching SRTP keys over a loopback handshake', async () => {
    const server = await boundSocket();
    const client = await boundSocket();

    const serverSide = negotiateDtlsSrtp('127.0.0.1', client.port, {
      role: 'server',
      socket: server.socket,
    });
    const clientSide = negotiateDtlsSrtp('127.0.0.1', server.port, {
      role: 'client',
      socket: client.socket,
    });

    const [s, c] = await Promise.all([serverSide, clientSide]);

    // Each side's send key is the other side's receive key (RFC 5764 §4.2).
    expect(c.masterKey).toEqual(s.remoteMasterKey);
    expect(c.masterSalt).toEqual(s.remoteMasterSalt);
    expect(s.masterKey).toEqual(c.remoteMasterKey);
    expect(s.masterSalt).toEqual(c.remoteMasterSalt);
    // Keys are negotiated, not supplied, so the two directions differ.
    expect(c.masterKey).not.toEqual(c.remoteMasterKey);

    expect([0x0001, 0x0007]).toContain(c.profile);
    expect(c.profile).toBe(s.profile);
    expect(c.masterKey).toHaveLength(16);
    expect(c.masterSalt).toHaveLength(c.profile === 0x0007 ? 12 : 14);
    expect(c.remoteCertificate && c.remoteCertificate.length).toBeGreaterThan(0);

    c.close();
    s.close();
    server.socket.close();
    client.socket.close();
  });

  it('encrypts T.140 text with the negotiated keys', async () => {
    const server = await boundSocket();
    const client = await boundSocket();
    const received: Buffer[] = [];

    const serverSide = negotiateDtlsSrtp('127.0.0.1', client.port, {
      role: 'server',
      socket: server.socket,
      onRtpPacket: (packet) => received.push(Buffer.from(packet)),
    });
    const clientSide = negotiateDtlsSrtp('127.0.0.1', server.port, {
      role: 'client',
      socket: client.socket,
    });
    const [s, c] = await Promise.all([serverSide, clientSide]);

    const transport = new T140RtpTransport('127.0.0.1', server.port, {
      customTransport: c.transport,
      redEnabled: false,
    });
    transport.setupSrtp({
      masterKey: c.masterKey,
      masterSalt: c.masterSalt,
      remoteMasterKey: c.remoteMasterKey,
      remoteMasterSalt: c.remoteMasterSalt,
      profile: c.profile,
    });
    transport.sendText('secret text', { markerBit: true });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toHaveLength(1);
    const packet = received[0];
    expect(packet[0] >> 6).toBe(2);                          // still a valid RTP header
    expect(packet.length).toBeGreaterThan(12 + 'secret text'.length); // auth tag added
    expect(packet.subarray(12).toString('utf-8')).not.toContain('secret');

    transport.close();
    s.close();
    server.socket.close();
    client.socket.close();
  });

  it('createT140DtlsSrtpTransport pairs a handshake with a paced stream', async () => {
    const server = await boundSocket();
    const client = await boundSocket();
    const received: Buffer[] = [];

    const serverSide = negotiateDtlsSrtp('127.0.0.1', client.port, {
      role: 'server',
      socket: server.socket,
      onRtpPacket: (packet) => received.push(Buffer.from(packet)),
    });
    const clientReady = createT140DtlsSrtpTransport('127.0.0.1', server.port, {
      redEnabled: false,
      dtls: { socket: client.socket, role: 'client' },
    });
    const [s, created] = await Promise.all([serverSide, clientReady]);

    const stream = new EventEmitter();
    created.attachStream(stream);
    stream.emit('data', 'hello');
    stream.emit('end');
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received.length).toBeGreaterThan(0);
    expect(created.session.profile).toBe(s.profile);

    s.close();
    server.socket.close();
    client.socket.close();
  });

  it('fails closed when the handshake times out', async () => {
    const client = await boundSocket();
    const dead = await boundSocket();
    dead.socket.close(); // nothing answers on that port

    await expect(
      negotiateDtlsSrtp('127.0.0.1', dead.port, {
        role: 'client',
        socket: client.socket,
        handshakeTimeoutMs: 1200,
      })
    ).rejects.toThrow(/did not complete/);

    client.socket.close();
  });
});
