

<div align="center">

  ![T140LLM](logo.gif)

  <h1 style="border-bottom: none;">t140llm</h1>

  [![npm version](https://img.shields.io/npm/v/t140llm)](https://www.npmjs.com/package/t140llm)
  [![npm downloads](https://img.shields.io/npm/dm/t140llm)](https://www.npmjs.com/package/t140llm)
  [![license](https://img.shields.io/npm/l/t140llm)](https://mit-license.org/)

  <p>Convierte las respuestas en streaming de modelos LLM en texto en tiempo real <a href="https://www.itu.int/rec/T-REC-T.140">T.140</a> para SIP, WebRTC y (S)RTP.</p>

</div>

---

`t140llm` toma una respuesta en streaming de cualquier SDK de LLM y la emite como texto en tiempo real [ITU-T T.140](https://www.itu.int/rec/T-REC-T.140), carácter por carácter, a medida que llegan los tokens, a través de WebSocket, RTP, SRTP o un socket Unix. Es el puente entre un flujo moderno de completion de chat y la infraestructura de texto en tiempo real utilizada por SIP, WebRTC, retransmisión TTY/telecomunicaciones y dispositivos de asistencia.

## ¿Por qué T.140?

T.140 es el estándar para transmitir texto sobre IP a medida que se escribe, en lugar de después de que se compone el mensaje completo. Esto lo convierte en una buena opción para enlaces de baja latencia y con pérdida — servicios de accesibilidad, retransmisión TTY, radio con ruido e incluso satélite — donde se desea que cada carácter llegue por el cable de inmediato. La pipeline de RTP utiliza un modelo de envío impulsado por eventos que entrega caracteres con una latencia submilisegundo (promedio ~0,1 ms en el [benchmark incluido](examples/latency_benchmark.js)), frente a ~50 ms para el sondeo a intervalos fijos.

## Instalación

```sh
npm install t140llm
```

Requiere Node.js >= 16.

## Inicio rápido

Pasa la respuesta en streaming de cualquier SDK de LLM directamente a `processAIStream`:

```typescript
import { processAIStream } from "t140llm";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const stream = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Write a short story." }],
  stream: true,
});

// Emite T.140 sobre WebSocket (predeterminado ws://localhost:8765)
processAIStream(stream);
```

Los flujos se consumen tal cual — EventEmitters e iterables asíncronos (el formato que devuelven la mayoría de los SDK) funcionan ambos, sin necesidad de envolverlos. Para enviar T.140 directamente a un punto final de RTP en lugar de un WebSocket:

```typescript
import { processAIStreamToRtp } from "t140llm";

const transport = processAIStreamToRtp(stream, "192.168.1.100", 5004);
// transport.close() al finalizar
```

Ese es todo el alcance: crea un completion en streaming y pásalo a una función `processAIStream*`. Consulta la [guía de proveedores](docs/providers.md) para OpenAI, Anthropic, Google Gemini, Mistral, Cohere, Ollama y el Vercel AI SDK.

## Transportes

| Función | Salida | Notas |
| --- | --- | --- |
| `processAIStream` | WebSocket | Predeterminado; T.140 sobre `ws://` |
| `processAIStreamToRtp` | RTP sobre UDP | [FEC](docs/api.md) (RFC 5109) y redundancia opcionales |
| `processAIStreamToSrtp` | SRTP cifrado | Claves desde una frase de contraseña o las tuyas propias |
| `processAIStreamToDirectSocket` | Socket Unix SEQPACKET | Sin paso por WebSocket, sigue enmarcado con RTP |
| `processAIStreamsToMultiplexedRtp` | Un flujo RTP, muchos LLM | Etiquetado con CSRC; demultiplexación en el extremo remoto |

Cada transporte puede ser [preconectado](docs/api.md#pre-connecting-transports) antes de que exista el flujo (para reducir la latencia de inicio) y puede ejecutarse sobre un [transporte personalizado](docs/api.md#transportstream-interface) (canal de datos WebRTC, portador esteganográfico, etc.).

## Capacidades

- [x] Formato de carga útil RTP de T.140, redundancia y FEC (RFC 5109)
- [x] Entrega directa (S)RTP con limitación de tasa y agrupación de tokens configurables
- [x] Flujos de transporte personalizados (WebRTC, protocolos personalizados)
- [x] Sockets Unix SEQPACKET (multiflujo) y STREAM (monoflujo)
- [x] Transporte WebSocket
- [x] Multiplexación de flujos: combina múltiples flujos de LLM en una salida RTP
- [x] Soporte directo para iterables asíncronos: pasa flujos de SDK sin envolver en EventEmitter
- [x] Manejo de razonamiento y metadatos de salida
- [x] Procesamiento de retroceso (backspace) en T.140
- [x] Esteganografía: oculta paquetes RTP dentro de medios de cobertura ([guía](docs/steganography.md))

**Soporte de proveedores:** Vercel AI SDK · Anthropic · OpenAI · Cohere · Mistral · Google Gemini · Ollama · flujos de razonamiento · llamadas a herramientas. Consulta la [guía de proveedores](docs/providers.md).

## Ejemplos

Demos ejecutables en [`examples/`](examples/):

| Demo | Qué muestra |
| --- | --- |
| [`demo.js`](examples/demo.js) | El mismo flujo sobre WebSocket, RTP, SRTP y un socket directo, lado a lado |
| [`latency_benchmark.js`](examples/latency_benchmark.js) | Latencia de fragmento a cable para las rutas EventEmitter e iterable asíncrono |
| [`fec_demo.js`](examples/fec_demo.js) | Corrección de errores hacia adelante (FEC) recuperándose de pérdida de paquetes simulada |
| [`multiplexed_streams_example.js`](examples/multiplexed_streams_example.js) | Multiplexación de varios flujos de LLM en una salida RTP |
| [`baudot_ita2_tty_example.js`](examples/baudot_ita2_tty_example.js) | Transcodificación de T.140 a Baudot/ITA2 de 5 bits para una línea TTY/telegráfica |
| [`steganography/`](examples/steganography/) | Ocultación de paquetes RTP dentro de medios de cobertura |

Consulta [`examples/README.md`](examples/README.md) para saber cómo ejecutar cada uno.

## Documentación

- [Guía de proveedores](docs/providers.md) — cada SDK de LLM compatible
- [Referencia de la API](docs/api.md) — todas las funciones, clases y opciones de configuración
- [Tipos e interfaces](docs/types.md) — `RtpConfig`, `SrtpConfig`, `TransportStream`, errores, metadatos
- [Esteganografía](docs/steganography.md) — oculta paquetes RTP en medios de cobertura
- [Sitio completo de documentación](https://agrathwohl.github.io/t140llm/)

## Licencia

[MIT](https://mit-license.org/) © agrathwohl
