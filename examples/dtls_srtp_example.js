/**
 * SRTP with automatic key management (DTLS-SRTP, RFC 5764)
 *
 * RFC 3711 section 9.1 says SRTP "REQUIRED that automatic key management be
 * used". This example negotiates the keys over the wire with a DTLS handshake,
 * so neither side needs a shared passphrase or key file.
 *
 * Both roles run in this one process over loopback UDP:
 *   node examples/dtls_srtp_example.js
 */

const dgram = require("dgram");
const { EventEmitter } = require("events");
const {
  negotiateDtlsSrtp,
  processAIStreamToDtlsSrtp,
  extractT140Text,
  T140RtpTransport,
} = require("../dist");

/** Bind a UDP socket on an ephemeral loopback port. */
function bindSocket() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    socket.bind(0, "127.0.0.1", () => {
      resolve({ socket, port: socket.address().port });
    });
  });
}

/** A mock LLM stream that emits a few chunks and ends. */
function createMockAIStream() {
  const stream = new EventEmitter();
  const chunks = ["Keys ", "were ", "negotiated, ", "not ", "shared."];
  let i = 0;
  const timer = setInterval(() => {
    if (i < chunks.length) {
      stream.emit("data", chunks[i]);
      i += 1;
    } else {
      clearInterval(timer);
      stream.emit("end");
    }
  }, 200);
  return stream;
}

async function main() {
  const receiver = await bindSocket();
  const sender = await bindSocket();

  console.log("Starting DTLS handshake on loopback...");

  // The receiving side. It also gets the keys, so it could decrypt the media.
  const receiverSide = negotiateDtlsSrtp("127.0.0.1", sender.port, {
    role: "server",
    socket: receiver.socket,
    // Ask the client for a certificate so its fingerprint can be checked.
    // Without this a server has no peer certificate.
    certificateRequest: true,
    onRtpPacket: (packet) => {
      // Packets arrive encrypted. Decrypting them needs an SRTP receive
      // context built from session.remoteMasterKey and remoteMasterSalt.
      console.log(`  <- SRTP packet, ${packet.length} bytes (encrypted)`);
    },
  });

  // The sending side, paired with a stream in one call.
  const senderSide = processAIStreamToDtlsSrtp(
    createMockAIStream(),
    "127.0.0.1",
    receiver.port,
    {
      charRateLimit: 30,
      dtls: { role: "client", socket: sender.socket },
    },
  );

  const [session, transport] = await Promise.all([receiverSide, senderSide]);

  const profileName =
    session.profile === 0x0007
      ? "SRTP_AEAD_AES_128_GCM"
      : "SRTP_AES128_CM_HMAC_SHA1_80";
  console.log(`Handshake complete. Profile: ${profileName}`);
  console.log(`  send key   ${session.masterKey.length} bytes`);
  console.log(`  send salt  ${session.masterSalt.length} bytes`);
  console.log(
    `  peer cert  ${
      session.remoteCertificate
        ? `${session.remoteCertificate.length} bytes`
        : "none (client sent no certificate)"
    }`,
  );
  console.log("No passphrase or key file was used.\n");

  // Let the stream drain, then clean up.
  setTimeout(() => {
    transport.close();
    session.close();
    receiver.socket.close();
    try {
      sender.socket.close();
    } catch (e) {
      // already closed with the transport
    }
    console.log("\nDone.");
    process.exit(0);
  }, 3000);
}

main().catch((err) => {
  console.error("DTLS-SRTP example failed:", err.message);
  process.exit(1);
});
