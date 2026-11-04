# t140llm Security & Bad Practices Audit

**Date:** 2026-02-22
**Scope:** All 35 source files in `src/`
**Version:** 0.0.18

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 7 |
| Medium | 5 |
| Low | 4 |
| **Total** | **19** |

---

## Critical Severity

### S1. Remote Code Execution via eval() (CRITICAL)

**File:** `src/steganography/steg-transport.ts` line ~135
**CWE:** CWE-94 (Improper Control of Generation of Code)

When `encodeMode` is `'llm'`, the library sends a prompt to an LLM asking it to generate a JavaScript encoding function, then **executes the response directly with `eval()`**:

```typescript
// steg-transport.ts (reconstructed from analysis)
const generatedCode = await llmProvider.complete(prompt);
this.encodeFunction = eval(generatedCode);  // RCE
```

**Impact:**
- If the LLM is compromised, poisoned, or returns unexpected output, **arbitrary code executes** in the Node.js process
- Prompt injection attacks could manipulate the generated algorithm
- No sandboxing, no AST validation, no allowlist of safe operations
- Full access to `process`, `require`, `fs`, `child_process`, etc.

**References:**
- OWASP: Code Injection (https://owasp.org/www-community/attacks/Code_Injection)
- CWE-94: https://cwe.mitre.org/data/definitions/94.html

**Recommendation:**
Remove `eval()` entirely. Use a predefined set of encoding algorithms selectable by name:
```typescript
const ALGORITHMS: Record<string, StegAlgorithm> = {
  'lsb': new LSBAlgorithm(),
  'dct': new DCTAlgorithm(),
};
```
If dynamic algorithms are truly needed, use a WebAssembly sandbox or `vm2` with strict context.

---

### S2. Math.random() for Security-Critical Operations (CRITICAL)

**File:** `src/steganography/steg-transport.ts` lines 60, 294–297
**CWE:** CWE-338 (Use of Cryptographically Weak PRNG)

`Math.random()` is used for:
1. **Cover media selection** (line 60): Determines which cover image hides data
2. **Seed generation** (lines 294–297): Seeds the steganographic encoding pattern

`Math.random()` uses xorshift128+ which is **not cryptographically secure**. The internal state can be reconstructed from ~5 observed outputs, allowing an attacker to predict all future random values.

**Impact:**
- Attacker can predict which cover media will be used
- Attacker can predict data placement within the cover
- **Completely defeats the security model of the steganography feature**

**References:**
- OWASP Cryptographic Storage Cheat Sheet: CXNULL
- Node.js `crypto.randomBytes`: https://nodejs.org/api/crypto.html#cryptorandombytessize-callback
- CWE-338: https://cwe.mitre.org/data/definitions/338.html

**Recommendation:**
Replace with `crypto.randomBytes()`:
```typescript
import { randomBytes } from 'crypto';
const index = randomBytes(4).readUInt32BE(0) % coverMedia.length;
```
Note: `src/utils/security.ts` already implements `generateSecureSSRC()` correctly using `crypto.randomBytes()` — the pattern exists in the codebase.

---

### S3. Silent TLS-to-Plaintext Downgrade (CRITICAL)

**File:** `src/transport/websocket-server.ts` lines 33–62
**CWE:** CWE-319 (Cleartext Transmission of Sensitive Information)

When TLS certificate loading fails (wrong path, invalid format, permission denied), the server **silently falls back to unencrypted WebSocket**. Only a `console.warn()` is emitted:

```typescript
try {
  const cert = fs.readFileSync(options.tls.cert);
  const key = fs.readFileSync(options.tls.key);
  // ... create HTTPS server
} catch (e) {
  console.warn('TLS setup failed, falling back to WS');
  // Creates unencrypted HTTP server instead
}
```

**Impact:**
- Applications expecting WSS transmit real-time text in plaintext
- Man-in-the-middle attacks become trivial
- Security contract silently violated — caller receives no error or exception
- Compliance violations (HIPAA, GDPR, etc.) if used for sensitive communications

**References:**
- OWASP TLS Cheat Sheet: CXNULL
- CWE-319: https://cwe.mitre.org/data/definitions/319.html

**Recommendation:**
Throw on TLS failure. Never silently downgrade:
```typescript
if (options.tls) {
  try {
    const cert = fs.readFileSync(options.tls.cert, 'utf8');
    const key = fs.readFileSync(options.tls.key, 'utf8');
    if (!cert.includes('-----BEGIN CERTIFICATE-----')) {
      throw new Error('Invalid certificate format');
    }
    // create HTTPS server
  } catch (error) {
    throw new Error(`TLS setup failed: ${error.message}. Refusing to start insecure server.`);
  }
}
```

---

## High Severity

### S4. UDP Socket Created Without Error Handler (HIGH)

**File:** `src/steganography/transport-factory.ts` lines 11–32
**CWE:** CWE-755 (Improper Handling of Exceptional Conditions)

`createDefaultTransport()` creates a UDP socket via `dgram.createSocket('udp4')` but **never attaches an `'error'` event handler**. Per Node.js docs, an unhandled `'error'` event on an EventEmitter crashes the process.

```typescript
const socket = dgram.createSocket('udp4');
// No socket.on('error', ...) — process will crash on network error
return { send: (data, callback) => socket.send(data, ..., callback) };
```

**Impact:**
- Any network error (ECONNREFUSED, ENETUNREACH, etc.) crashes the entire Node.js process
- No graceful degradation or error recovery possible

**References:**
- Node.js dgram docs: https://nodejs.org/api/dgram.html#event-error
- Node.js EventEmitter: Unhandled 'error' events throw

**Recommendation:**
```typescript
const socket = dgram.createSocket('udp4');
socket.on('error', (err) => {
  // Propagate error to caller or emit on transport
});
```

---

### S5. SEQPACKET Socket Connection Never Verified (HIGH)

**File:** `src/transport/websocket-server.ts` line ~72
**CWE:** CWE-252 (Unchecked Return Value)

UNIX domain socket (`net.createConnection`) is created without waiting for `'connect'` event or handling `'error'` event. Writes are attempted immediately, before connection is established.

**Impact:**
- Silent data loss if socket path doesn't exist
- Process crash on write to unconnected socket

**Recommendation:**
```typescript
const socket = net.createConnection(path);
socket.on('connect', () => { isReady = true; });
socket.on('error', (err) => { /* handle/propagate */ });
```

---

### S6. Certificate Loading Without Validation (HIGH)

**File:** `src/transport/websocket-server.ts` lines 36–43
**CWE:** CWE-295 (Improper Certificate Validation)

Certificates are loaded with `fs.readFileSync()` without:
- Specifying encoding (returns `Buffer`, but `https.createServer()` expects string for PEM)
- Validating PEM format
- Checking certificate validity/expiration
- Verifying cert/key pair match

**Impact:**
- Malformed certificates may cause cryptic runtime errors
- Expired certificates accepted silently
- Non-PEM files (DER, PKCS12) cause undefined behavior

**Recommendation:**
```typescript
const cert = fs.readFileSync(options.tls.cert, 'utf8');
const key = fs.readFileSync(options.tls.key, 'utf8');
if (!cert.includes('-----BEGIN CERTIFICATE-----')) {
  throw new Error('Certificate must be in PEM format');
}
if (!key.includes('-----BEGIN')) {
  throw new Error('Key must be in PEM format');
}
```

---

### S7. Dynamic require() Breaking Module Integrity (HIGH)

**File:** `src/steganography/transport-factory.ts` lines 84–86
**CWE:** CWE-470 (Use of Externally-Controlled Input to Select Classes/Code)

Uses `require()` at runtime to import `processAIStreamToRtp`, supposedly to avoid circular dependencies:

```typescript
const { processAIStreamToRtp } = require('../processors/process-ai-stream-to-rtp');
```

**Impact:**
- Bundlers (webpack, rollup, esbuild) cannot analyze this dependency
- Tree-shaking breaks — entire module included regardless of usage
- Refactoring file paths breaks silently at runtime, not at compile time
- Type safety completely lost at the `require()` boundary

**Recommendation:**
Restructure modules to break the circular dependency. Pass `processAIStreamToRtp` as a parameter injection instead.

---

### S8. Rate Limiting Inconsistently Implemented (HIGH)

**Files:** All processors
**CWE:** CWE-770 (Allocation of Resources Without Limits)

`charRateLimit` is present in `RtpConfig` and `SrtpConfig` (via inheritance), but rate limiting is **only implemented in the RTP processor** via a token bucket algorithm. The SRTP, WebSocket, and DirectSocket processors **silently ignore** the configuration.

| Processor | Rate Limiting |
|-----------|--------------|
| `process-ai-stream-to-rtp.ts` | ✅ Token bucket (grapheme-aware) |
| `process-ai-stream-to-srtp.ts` | ❌ Ignored |
| `process-ai-stream.ts` (WebSocket) | ❌ Not applicable in config |
| `process-ai-stream-to-direct-socket.ts` | ❌ Ignored |

**Impact:**
- SRTP transport can flood the network
- SLA/bandwidth contracts violated
- `SrtpConfig` accepts `charRateLimit` silently, user believes it's enforced

**Recommendation:**
Either implement rate limiting in all processors (extract to shared utility) or explicitly exclude `charRateLimit` from `SrtpConfig` interface and document the limitation.

---

### S9. Error Handlers Silently Swallow Errors (HIGH)

**Files:** All 4 processor files
**CWE:** CWE-390 (Detection of Error Condition Without Action)

Every processor binds a stream error handler that **discards the error and only closes the transport**:

```typescript
stream.on('error', (_err) => {
  transport.close?.();
});
```

The `_err` underscore prefix confirms the error object is intentionally unused.

**Impact:**
- Network failures, protocol errors, and stream corruption are invisible
- No way for callers to detect, log, or recover from errors
- Debugging production issues becomes extremely difficult

**Recommendation:**
At minimum, re-emit errors on the transport or invoke a user-provided error callback:
```typescript
stream.on('error', (err) => {
  options.onError?.(err);
  transport.close?.();
});
```

---

### S10. processAIStreamToStegRtp Ignores Return Value (HIGH)

**File:** `src/steganography/transport-factory.ts` line ~68

The function calls `processAIStreamToRtp()` (via dynamic `require()`) but **discards the return value**, returning a pre-created transport instead.

**Impact:**
- The returned transport may not be the one with the stream attached
- Consumer receives a potentially disconnected transport object
- Stream processing state becomes orphaned

**Recommendation:**
Return the value from `processAIStreamToRtp()` or validate that the pre-created transport is correctly attached.

---

## Medium Severity

### S11. Backspace Buffer Never Flushed on Stream End (MEDIUM)

**Files:** All 4 processor files
**CWE:** CWE-404 (Improper Resource Shutdown)

When a stream ends, any remaining text in the backspace processing buffer is **silently discarded**:

```typescript
stream.on('end', () => {
  transport.close?.();  // Buffer lost
});
```

**Impact:**
- Final characters of LLM responses may be lost
- Data loss without notification

**Recommendation:**
Flush the buffer before closing:
```typescript
stream.on('end', () => {
  if (textBuffer.length > 0) {
    transport.send(Buffer.from(textBuffer, 'utf-8'));
  }
  transport.close?.();
});
```

---

### S12. Metadata JSON Not Size-Limited (MEDIUM)

**File:** `src/processors/process-ai-stream-to-direct-socket.ts` lines 65–68
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

When `sendMetadataOverTransport` is enabled, metadata is serialized to JSON without size validation:

```typescript
const metadataJson = JSON.stringify(metadata);
transport.send(Buffer.from(`MD:${metadataJson}`, 'utf-8'));
```

**Impact:**
- Large tool call results or reasoning traces can produce payloads exceeding MTU
- Causes UDP fragmentation or packet loss
- Receiver may fail to parse partial JSON

**Recommendation:**
Enforce a maximum metadata payload size (e.g., 1200 bytes for safe UDP):
```typescript
const metadataJson = JSON.stringify(metadata);
if (Buffer.byteLength(metadataJson, 'utf-8') > MAX_METADATA_SIZE) {
  // Truncate, split, or skip
}
```

---

### S13. Metadata Callback Exceptions Crash Pipeline (MEDIUM)

**Files:** All 4 processors
**CWE:** CWE-248 (Uncaught Exception)

User-provided `metadataCallback` is invoked without `try/catch`:

```typescript
options.metadataCallback?.(metadata);
```

If the callback throws, the entire stream processing pipeline crashes — there is no error boundary.

**Recommendation:**
```typescript
try {
  options.metadataCallback?.(metadata);
} catch (err) {
  // Log or emit error, don't crash pipeline
}
```

---

### S14. SRTP Profile Not Validated Against Registry (MEDIUM)

**File:** `src/interfaces/srtp-config.interface.ts`
**CWE:** CWE-20 (Improper Input Validation)

`SrtpConfig.profile` is typed as `number` with no validation. Valid SRTP protection profiles per IANA registry are 0x0001–0x0008. Invalid values produce undefined behavior in the SRTP layer.

**References:**
- RFC 3711 §3: SRTP cryptographic context requirements
- IANA SRTP Protection Profiles registry

**Recommendation:**
Use a union type or enum:
```typescript
type SrtpProfile = 0x0001 | 0x0002 | 0x0003 | 0x0004 | 0x0005 | 0x0006 | 0x0007 | 0x0008;
```

---

### S15. Console Logging in Library Code (MEDIUM)

**Files:** `websocket-server.ts`, `steg-transport.ts`
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

Libraries should not write directly to stdout/stderr. Found:
- `websocket-server.ts`: `console.log` (3 locations), `console.warn` (1)
- `steg-transport.ts`: `console.error` (4 locations)

**Impact:**
- Output pollutes consumer's stdout
- Cannot be silenced without monkey-patching console
- May leak sensitive information (addresses, ports, error details)

**Recommendation:**
Use the `debug` package (already a dependency) or emit events:
```typescript
import createDebug from 'debug';
const debug = createDebug('t140llm:steg');
debug('encoding failed: %O', error);
```

---

## Low Severity

### S16. No Backpressure Handling on Transports (LOW)

**File:** `src/interfaces/transport-stream.interface.ts`
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

`TransportStream.send()` has no mechanism to signal backpressure. High-volume LLM streams can overwhelm slow transports (e.g., constrained WebRTC channels) with no flow control.

**Recommendation:**
Return `boolean` from `send()` (like Node.js `Writable.write()`) to signal buffer fullness.

---

### S17. close() Optional on TransportStream (LOW)

**File:** `src/interfaces/transport-stream.interface.ts` line 16
**CWE:** CWE-404 (Improper Resource Shutdown)

`close()` is marked optional. Transports that omit it leak resources (open sockets, file descriptors).

**Recommendation:**
Make `close()` required or implement a `Symbol.dispose` pattern for `using` declarations.

---

### S18. @types/ws as Runtime Dependency (LOW)

**File:** `package.json`

`@types/ws: 7.4.7` is listed under `dependencies` instead of `devDependencies`. Type declaration packages are build-time only.

**Impact:**
- Unnecessary bytes shipped to consumers
- Potential version conflicts with consumer's own `@types/ws`

**Recommendation:**
Move to `devDependencies`.

---

### S19. Deprecated Model Reference (LOW)

**File:** `src/steganography/steg-transport.ts` line ~223

The LLM prompt for algorithm generation references `text-davinci-003`, an OpenAI model that was **deprecated and decommissioned in January 2024**.

**Impact:**
- Feature is non-functional with default configuration
- Would cause runtime error if LLM mode is activated

**Recommendation:**
Update to a current model, or better yet, remove the LLM algorithm generation feature entirely (see S1).

---

*Generated by codebase audit, 2026-02-22*
