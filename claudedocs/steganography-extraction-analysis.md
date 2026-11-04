# Steganography Module Extraction Analysis

## Executive Summary

This document analyzes the feasibility and approach for extracting the steganography feature from `t140llm` into a standalone, transport-agnostic library that provides first-class LLM stream support while remaining compatible with T.140, RTP, WebRTC, and other streaming protocols.

**Key Finding**: The current steganography module is **loosely coupled** with only 2 direct dependencies on `t140llm` internals, making extraction highly feasible with minimal refactoring.

---

## 1. Current Architecture Analysis

### 1.1 Steganography Module Files

```
src/steganography/
├── index.ts                    # Barrel exports
├── steg-config.interface.ts    # Configuration interface (NO dependencies)
├── steg-transport.interface.ts # Transport interface (1 dependency)
├── steg-transport.ts           # Core implementation (2 dependencies)
├── rtp-config-extensions.ts    # RTP integration (2 dependencies)
└── transport-factory.ts        # Factory functions (4 dependencies - MOST COUPLED)
```

### 1.2 Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────┐
│                        STEGANOGRAPHY MODULE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐    ┌────────────────────────┐                 │
│  │  StegConfig      │    │  StegTransport         │                 │
│  │  (interface)     │◄───│  (interface)           │                 │
│  │  NO DEPS         │    │  extends TransportStream│                │
│  └──────────────────┘    └───────────┬────────────┘                 │
│                                      │                               │
│                                      ▼                               │
│                          ┌───────────────────────┐                   │
│                          │  StegTransport        │                   │
│                          │  (class)              │                   │
│                          │  DEPS: TransportStream│                   │
│                          │        StegConfig     │                   │
│                          └───────────────────────┘                   │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                     RTP INTEGRATION LAYER                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────┐    ┌──────────────────────────┐         │
│  │  RtpConfigWithSteg     │    │  transport-factory.ts    │         │
│  │  extends RtpConfig     │    │  DEPS: dgram, RtpConfig  │         │
│  │  + steganography?      │    │        T140RtpTransport  │         │
│  └────────────────────────┘    │        DEFAULT_RTP_PORT  │         │
│                                │        StegTransport     │         │
│                                └──────────────────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 External Dependencies from t140llm

| File | Import | Coupling Level |
|------|--------|----------------|
| `steg-transport.interface.ts` | `TransportStream` | **LOW** - Generic interface |
| `steg-transport.ts` | `TransportStream`, `StegConfig` | **LOW** - Generic interface |
| `rtp-config-extensions.ts` | `RtpConfig`, `StegConfig` | **MEDIUM** - RTP-specific |
| `transport-factory.ts` | `dgram`, `RtpConfig`, `TransportStream`, `T140RtpTransport`, `DEFAULT_RTP_PORT` | **HIGH** - RTP-specific factory |

---

## 2. Extraction Strategy

### 2.1 What Moves to the New Package

**Core Steganography (MUST MOVE):**
```
llm-steg/
├── src/
│   ├── index.ts
│   ├── interfaces/
│   │   ├── steg-config.interface.ts      # Cleaned up, no external deps
│   │   ├── steg-transport.interface.ts   # Uses new generic TransportStream
│   │   └── transport-stream.interface.ts # NEW: Copied & generalized
│   ├── core/
│   │   ├── steg-transport.ts             # Core LSB implementation
│   │   └── steg-encoder.ts               # NEW: Extracted encode/decode logic
│   ├── algorithms/
│   │   ├── lsb.ts                        # Default LSB algorithm
│   │   └── llm-generated.ts              # LLM algorithm generation
│   └── adapters/
│       ├── stream-adapter.ts             # LLM stream abstraction
│       ├── rtp-adapter.ts                # RTP/SRTP integration
│       ├── webrtc-adapter.ts             # WebRTC DataChannel support
│       ├── websocket-adapter.ts          # WebSocket support
│       └── raw-adapter.ts                # Raw UDP/TCP support
```

**Stays in t140llm:**
```
src/steganography/
├── rtp-config-extensions.ts    # STAYS - RTP-specific extension
└── transport-factory.ts        # REFACTORED - Uses llm-steg as dependency
```

### 2.2 New TransportStream Interface (Transport-Agnostic)

```typescript
/**
 * Generic transport interface for any streaming protocol
 * Supports: UDP, TCP, WebSocket, WebRTC DataChannel, RTP, SRTP, etc.
 */
export interface TransportStream {
  /**
   * Send data through the transport
   * @param data The binary data to send
   * @param callback Optional completion callback
   */
  send(data: Buffer | Uint8Array, callback?: (error?: Error) => void): void;

  /**
   * Optional: Receive data (for bidirectional transports)
   */
  onData?(handler: (data: Buffer | Uint8Array) => void): void;

  /**
   * Close the transport and cleanup resources
   */
  close?(): void;

  /**
   * Get transport metadata (protocol type, connection state, etc.)
   */
  getMetadata?(): TransportMetadata;
}

export interface TransportMetadata {
  protocol: 'udp' | 'tcp' | 'websocket' | 'webrtc' | 'rtp' | 'srtp' | 'custom';
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
  remoteAddress?: string;
  remotePort?: number;
}
```

### 2.3 New LLM Stream Interface (First-Class LLM Support)

```typescript
import { EventEmitter } from 'events';

/**
 * Universal LLM stream interface supporting all major providers
 * OpenAI, Anthropic, Mistral, Cohere, Gemini, Ollama, etc.
 */
export interface LLMStream extends EventEmitter {
  on(event: 'text', listener: (text: string) => void): this;
  on(event: 'metadata', listener: (metadata: LLMMetadata) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export interface LLMMetadata {
  type: 'tool_call' | 'tool_result' | 'reasoning' | 'function_call' | 'custom';
  provider: 'openai' | 'anthropic' | 'mistral' | 'cohere' | 'gemini' | 'ollama' | 'custom';
  content: any;
  id?: string;
}

/**
 * Adapter to convert any LLM provider stream to LLMStream
 */
export interface LLMStreamAdapter {
  wrap(providerStream: any): LLMStream;
  extractText(chunk: any): string;
  extractMetadata(chunk: any): LLMMetadata | null;
}
```

---

## 3. New Package Architecture

### 3.1 Package Structure: `@t140llm/steg` or `llm-steg`

```
llm-steg/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                      # Main exports
│   │
│   ├── interfaces/                   # All type definitions
│   │   ├── index.ts
│   │   ├── steg-config.interface.ts
│   │   ├── steg-transport.interface.ts
│   │   ├── transport-stream.interface.ts
│   │   ├── llm-stream.interface.ts
│   │   └── cover-media.interface.ts
│   │
│   ├── core/                         # Core steganography engine
│   │   ├── index.ts
│   │   ├── steg-engine.ts            # Main encode/decode orchestration
│   │   ├── steg-transport.ts         # Transport wrapper with steg
│   │   └── cover-media-manager.ts    # Cover media pool management
│   │
│   ├── algorithms/                   # Encoding algorithms
│   │   ├── index.ts
│   │   ├── algorithm.interface.ts    # Algorithm contract
│   │   ├── lsb.ts                    # Least Significant Bit
│   │   ├── dct.ts                    # Discrete Cosine Transform
│   │   ├── spread-spectrum.ts        # Spread spectrum encoding
│   │   └── llm-generated.ts          # Dynamic LLM-generated algorithms
│   │
│   ├── adapters/                     # Protocol adapters
│   │   ├── index.ts
│   │   ├── base-adapter.ts           # Abstract base adapter
│   │   ├── udp-adapter.ts            # Raw UDP
│   │   ├── tcp-adapter.ts            # Raw TCP
│   │   ├── websocket-adapter.ts      # WebSocket (ws/wss)
│   │   ├── webrtc-adapter.ts         # WebRTC DataChannel
│   │   ├── rtp-adapter.ts            # RTP/SRTP via werift-rtp
│   │   └── custom-adapter.ts         # User-defined transports
│   │
│   ├── llm/                          # LLM stream handling
│   │   ├── index.ts
│   │   ├── stream-normalizer.ts      # Normalize any LLM stream format
│   │   ├── text-extractor.ts         # Extract text from LLM chunks
│   │   ├── metadata-extractor.ts     # Extract tool calls, reasoning
│   │   └── providers/
│   │       ├── openai.ts
│   │       ├── anthropic.ts
│   │       ├── mistral.ts
│   │       ├── cohere.ts
│   │       ├── gemini.ts
│   │       └── ollama.ts
│   │
│   └── utils/                        # Shared utilities
│       ├── index.ts
│       ├── buffer-utils.ts
│       ├── random.ts
│       └── validation.ts
│
├── tests/
│   ├── core/
│   ├── algorithms/
│   ├── adapters/
│   └── llm/
│
└── examples/
    ├── basic-lsb.ts
    ├── webrtc-streaming.ts
    ├── rtp-t140.ts
    └── anthropic-stream.ts
```

### 3.2 Core API Design

```typescript
// Main entry point
import {
  StegEngine,
  createStegTransport,
  // Adapters
  UdpAdapter,
  WebSocketAdapter,
  WebRTCAdapter,
  RtpAdapter,
  // Algorithms
  LSBAlgorithm,
  DCTAlgorithm,
  LLMGeneratedAlgorithm,
  // LLM support
  LLMStreamNormalizer,
  // Types
  StegConfig,
  TransportStream,
  LLMStream
} from 'llm-steg';

// Example: LLM stream over WebRTC with steganography
const webrtc = new WebRTCAdapter(dataChannel);
const steg = createStegTransport(webrtc, {
  algorithm: 'lsb',
  coverMedia: imageBuffers,
  enabled: true
});

// Normalize Anthropic stream and send with steganography
const llmStream = LLMStreamNormalizer.wrap(anthropicStream, 'anthropic');
llmStream.on('text', (text) => {
  steg.send(Buffer.from(text));
});

// Example: T.140 over RTP with steganography (for t140llm integration)
const rtp = new RtpAdapter('192.168.1.100', 5004, rtpConfig);
const steg = createStegTransport(rtp, stegConfig);
// Use with t140llm's processAIStreamToRtp
```

---

## 4. Migration Path

### 4.1 Phase 1: Extract Core (Non-Breaking)

1. Create `llm-steg` package with core interfaces and implementation
2. Copy and generalize `TransportStream` interface
3. Extract `StegTransport` class with no t140llm dependencies
4. Implement LSB algorithm as standalone module
5. Add tests for core functionality

### 4.2 Phase 2: Add Adapters

1. Implement `UdpAdapter` (mirrors current behavior)
2. Implement `WebSocketAdapter`
3. Implement `WebRTCAdapter`
4. Implement `RtpAdapter` (uses werift-rtp)
5. Each adapter is optional peer dependency

### 4.3 Phase 3: LLM Stream Support

1. Port `extractTextFromChunk` to `LLMStreamNormalizer`
2. Add provider-specific extractors
3. Implement unified `LLMStream` interface
4. Add streaming pipeline utilities

### 4.4 Phase 4: Update t140llm (Breaking Change)

1. Add `llm-steg` as dependency
2. Remove `src/steganography/` core files
3. Keep `rtp-config-extensions.ts` using llm-steg types
4. Update `transport-factory.ts` to use llm-steg
5. Update exports in `index.ts`

---

## 5. Compatibility Matrix

### 5.1 Transport Protocol Support

| Protocol | Adapter | Status | Notes |
|----------|---------|--------|-------|
| UDP | `UdpAdapter` | ✅ Ready | Native dgram |
| TCP | `TcpAdapter` | 📋 Planned | Native net |
| WebSocket | `WebSocketAdapter` | ✅ Ready | ws library |
| WebRTC | `WebRTCAdapter` | 📋 Planned | wrtc or browser API |
| RTP | `RtpAdapter` | ✅ Ready | werift-rtp |
| SRTP | `SrtpAdapter` | ✅ Ready | werift-rtp |
| Unix Socket | `UnixSocketAdapter` | 📋 Planned | node-unix-socket |
| Custom | `CustomAdapter` | ✅ Ready | User-defined |

### 5.2 LLM Provider Support

| Provider | Normalizer | Status | Streaming Format |
|----------|------------|--------|------------------|
| OpenAI | `OpenAINormalizer` | ✅ Ready | `choices[0].delta.content` |
| Anthropic | `AnthropicNormalizer` | ✅ Ready | `delta.text` |
| Mistral | `MistralNormalizer` | ✅ Ready | `delta.content` |
| Cohere | `CohereNormalizer` | ✅ Ready | `text` |
| Gemini | `GeminiNormalizer` | ✅ Ready | `candidates[0].content.parts[0].text` |
| Ollama | `OllamaNormalizer` | ✅ Ready | `response` |
| Vercel AI SDK | `VercelNormalizer` | ✅ Ready | `choices[0].delta.content` |
| Custom | `CustomNormalizer` | ✅ Ready | User-defined |

---

## 6. Code Examples

### 6.1 Basic Steganography (Transport-Agnostic)

```typescript
import { createStegTransport, UdpAdapter, LSBAlgorithm } from 'llm-steg';

// Create UDP transport
const udp = new UdpAdapter('192.168.1.100', 5004);

// Wrap with steganography
const steg = createStegTransport(udp, {
  algorithm: new LSBAlgorithm(),
  coverMedia: [Buffer.alloc(1024, 0xFF)],
  enabled: true
});

// Send hidden data
steg.send(Buffer.from('Secret message'), (err) => {
  if (!err) console.log('Sent with steganography');
});

// Decode received data
steg.onData((data) => {
  const decoded = steg.decode(data);
  console.log('Decoded:', decoded.toString());
});
```

### 6.2 LLM Stream with WebRTC

```typescript
import {
  createStegTransport,
  WebRTCAdapter,
  LLMStreamNormalizer
} from 'llm-steg';
import Anthropic from '@anthropic-ai/sdk';

// Setup WebRTC data channel
const adapter = new WebRTCAdapter(dataChannel);
const steg = createStegTransport(adapter, {
  algorithm: 'lsb',
  coverMedia: await loadCoverImages(),
  enabled: true
});

// Stream from Claude
const anthropic = new Anthropic();
const stream = await anthropic.messages.stream({
  model: 'claude-3-5-sonnet-20241022',
  messages: [{ role: 'user', content: 'Hello!' }],
  max_tokens: 1024
});

// Normalize and send with steganography
const llmStream = LLMStreamNormalizer.wrap(stream, 'anthropic');
llmStream.on('text', (text) => {
  steg.send(Buffer.from(text, 'utf-8'));
});
llmStream.on('end', () => steg.close());
```

### 6.3 T.140 over RTP Integration (t140llm)

```typescript
import { createStegT140RtpTransport } from 't140llm';
// llm-steg is used internally by t140llm

const transport = createStegT140RtpTransport('192.168.1.100', 5004, {
  payloadType: 98,
  ssrc: 12345,
  steganography: {
    enabled: true,
    algorithm: 'lsb',
    coverMedia: [audioCoverBuffer]
  }
});

// Use with AI stream
processAIStreamToStegRtp(anthropicStream, '192.168.1.100', 5004, {
  steganography: { enabled: true, coverMedia: [audioCoverBuffer] }
});
```

---

## 7. Breaking Changes & Migration Guide

### 7.1 For t140llm Users

**Before (current):**
```typescript
import { StegTransport, StegConfig } from 't140llm';
```

**After (with llm-steg):**
```typescript
// Option 1: Import from t140llm (re-exported)
import { StegTransport, StegConfig } from 't140llm';

// Option 2: Import directly from llm-steg
import { StegTransport, StegConfig } from 'llm-steg';
```

**No breaking changes for RTP-focused usage** - the factory functions remain the same:
```typescript
// This API stays identical
import { createStegT140RtpTransport, processAIStreamToStegRtp } from 't140llm';
```

### 7.2 For Direct Steganography Users

If directly using `StegTransport` class:
```typescript
// Before
import { TransportStream } from 't140llm/interfaces';
import { StegTransport } from 't140llm/steganography';

// After
import { TransportStream, StegTransport } from 'llm-steg';
```

---

## 8. Implementation Priority

### 8.1 MVP (Week 1)
1. ✅ Extract `TransportStream` interface
2. ✅ Extract `StegConfig` interface
3. ✅ Extract `StegTransport` class
4. ✅ Implement `LSBAlgorithm`
5. ✅ Implement `UdpAdapter`
6. ✅ Basic test suite

### 8.2 LLM Support (Week 2)
1. 📋 Port `extractTextFromChunk` → `LLMStreamNormalizer`
2. 📋 Add provider-specific normalizers
3. 📋 Implement `LLMStream` interface
4. 📋 Add WebSocket adapter

### 8.3 Advanced Transports (Week 3)
1. 📋 Implement `WebRTCAdapter`
2. 📋 Implement `RtpAdapter`
3. 📋 Add DCT algorithm option
4. 📋 Integration tests

### 8.4 t140llm Integration (Week 4)
1. 📋 Add `llm-steg` dependency to t140llm
2. 📋 Remove redundant code
3. 📋 Update factory functions
4. 📋 Update documentation
5. 📋 Release t140llm v0.1.0 (semver major due to restructure)

---

## 9. Recommendations

### 9.1 Package Naming
- **Recommended**: `@t140llm/steg` (scoped, clear relationship)
- **Alternative**: `llm-steg` (shorter, independent branding)

### 9.2 Versioning Strategy
- Start at `1.0.0` for new package (stable API from day 1)
- t140llm bumps to `0.1.0` when integrating (semver minor for new features)

### 9.3 Peer Dependencies
```json
{
  "peerDependencies": {
    "werift-rtp": "^0.8.0",    // Optional: For RTP adapter
    "ws": "^8.0.0",             // Optional: For WebSocket adapter
    "wrtc": "^0.5.0"            // Optional: For WebRTC adapter (Node.js)
  },
  "peerDependenciesMeta": {
    "werift-rtp": { "optional": true },
    "ws": { "optional": true },
    "wrtc": { "optional": true }
  }
}
```

---

## 10. Conclusion

The steganography module extraction is **highly feasible** with:
- **Low coupling**: Only 2 interface dependencies on t140llm
- **Clean separation**: Core logic independent of transport protocol
- **Minimal breaking changes**: Factory functions remain compatible
- **Clear value-add**: First-class LLM stream support + multi-transport

The recommended approach creates a **reusable, transport-agnostic library** that:
1. Supports all major LLM streaming APIs out of the box
2. Works with any transport (WebSocket, WebRTC, RTP, raw UDP/TCP)
3. Maintains backward compatibility with t140llm
4. Enables new use cases (browser-based steganography, P2P hidden channels)

---

*Document generated: 2026-01-06*
*Analysis scope: t140llm v0.0.12*
