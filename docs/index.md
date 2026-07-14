---
layout: home
hero:
  name: t140llm
  text: Real-time text for LLM streams
  tagline: Convert LLM streaming responses into T.140 real-time text for SIP, WebRTC, and (S)RTP.
  actions:
    - theme: brand
      text: Get started
      link: /guide
    - theme: alt
      text: Provider guide
      link: /providers
    - theme: alt
      text: GitHub
      link: https://github.com/agrathwohl/t140llm
features:
  - title: Any LLM SDK
    details: Pass OpenAI, Anthropic, Gemini, Mistral, Cohere, Ollama, or Vercel AI SDK streams straight in — EventEmitters and async iterables both work, no wrapping.
  - title: Real transports
    details: WebSocket, RTP, SRTP, and Unix sockets, with FEC (RFC 5109), redundancy, and multiplexing of several LLM streams into one output.
  - title: Low latency
    details: An event-driven send model delivers characters with sub-millisecond chunk-to-wire latency — built for lossy and time-sensitive links.
---
