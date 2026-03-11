/**
 * Latency Benchmark for t140llm Event-Driven Drain
 *
 * Measures chunk-to-wire latency through the RTP processing pipeline.
 * Tests both EventEmitter and AsyncIterable stream paths.
 *
 * Usage: npm run build && node examples/latency_benchmark.js
 */

const { EventEmitter } = require('events');
const { processAIStreamToRtp } = require('../dist');

// ---------------------------------------------------------------------------
// Instrumented custom transport — timestamps every send()
// ---------------------------------------------------------------------------

class LatencyTransport {
  constructor() {
    this.sends = [];         // { sentAt: hrtime, size: number }
    this.totalBytes = 0;
  }

  send(data, callback) {
    const now = process.hrtime.bigint();
    this.sends.push({ sentAt: now, size: data.length });
    this.totalBytes += data.length;
    if (callback) callback();
  }

  close() {}
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeStats(latenciesNs) {
  if (latenciesNs.length === 0) return null;
  const sorted = [...latenciesNs].sort((a, b) => Number(a - b));
  const toMs = (ns) => Number(ns) / 1e6;
  return {
    count: sorted.length,
    min: toMs(sorted[0]),
    max: toMs(sorted[sorted.length - 1]),
    avg: toMs(sorted.reduce((a, b) => a + b, 0n) / BigInt(sorted.length)),
    p50: toMs(percentile(sorted, 50)),
    p95: toMs(percentile(sorted, 95)),
    p99: toMs(percentile(sorted, 99)),
  };
}

function printStats(label, stats) {
  if (!stats) { console.log(`  ${label}: no data`); return; }
  console.log(`  ${label}:`);
  console.log(`    count : ${stats.count}`);
  console.log(`    min   : ${stats.min.toFixed(3)} ms`);
  console.log(`    max   : ${stats.max.toFixed(3)} ms`);
  console.log(`    avg   : ${stats.avg.toFixed(3)} ms`);
  console.log(`    p50   : ${stats.p50.toFixed(3)} ms`);
  console.log(`    p95   : ${stats.p95.toFixed(3)} ms`);
  console.log(`    p99   : ${stats.p99.toFixed(3)} ms`);
}

// ---------------------------------------------------------------------------
// Simulated LLM token stream
// ---------------------------------------------------------------------------

const TOKENS = [
  'The ', 'quick ', 'brown ', 'fox ', 'jumps ', 'over ',
  'the ', 'lazy ', 'dog. ', 'Pack ', 'my ', 'box ', 'with ',
  'five ', 'dozen ', 'liquor ', 'jugs. ', 'How ', 'vexingly ',
  'quick ', 'daft ', 'zebras ', 'jump! ', 'The ', 'five ',
  'boxing ', 'wizards ', 'jump ', 'quickly. ', 'Sphinx ',
  'of ', 'black ', 'quartz, ', 'judge ', 'my ', 'vow. ',
  'Two ', 'driven ', 'jocks ', 'help ', 'fax ', 'my ',
  'big ', 'quiz. ', 'Quick ', 'zephyrs ', 'blow, ', 'vexing ',
  'daft ', 'Jim.',
];

// Simulates inter-token latency of real LLM output (~20-60ms)
const TOKEN_INTERVAL_MS = 30;

/**
 * EventEmitter stream — wraps tokens in OpenAI-shaped chunks
 */
function createEventEmitterStream(tokens, intervalMs) {
  const emitter = new EventEmitter();
  const emitTimes = []; // hrtime per emit

  let i = 0;
  const timer = setInterval(() => {
    if (i >= tokens.length) {
      emitter.emit('end');
      clearInterval(timer);
      return;
    }
    emitTimes.push(process.hrtime.bigint());
    emitter.emit('data', {
      choices: [{ delta: { content: tokens[i] } }],
    });
    i++;
  }, intervalMs);

  return { stream: emitter, emitTimes };
}

/**
 * AsyncIterable stream — yields OpenAI-shaped chunks
 */
function createAsyncIterableStream(tokens, intervalMs) {
  const emitTimes = [];

  async function* generate() {
    for (const token of tokens) {
      await new Promise((r) => setTimeout(r, intervalMs));
      emitTimes.push(process.hrtime.bigint());
      yield { choices: [{ delta: { content: token } }] };
    }
  }

  return { stream: generate(), emitTimes };
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

async function runBenchmark(label, streamFactory) {
  const transport = new LatencyTransport();

  // High rate limit so rate-limiting doesn't dominate the benchmark
  // (we're measuring pipeline latency, not rate-limiting behavior)
  const rtpConfig = {
    charRateLimit: 300,
    customTransport: transport,
  };

  const { stream, emitTimes } = streamFactory();
  processAIStreamToRtp(stream, '127.0.0.1', 5004, rtpConfig);

  // Wait for stream to complete + drain
  await new Promise((r) => setTimeout(r, TOKENS.length * TOKEN_INTERVAL_MS + 500));

  // Compute per-chunk latencies:
  // For each send, find the closest preceding emit and measure the gap
  const latencies = [];
  let emitIdx = 0;
  for (const send of transport.sends) {
    // Advance emitIdx to the latest emit that preceded this send
    while (
      emitIdx < emitTimes.length - 1 &&
      emitTimes[emitIdx + 1] <= send.sentAt
    ) {
      emitIdx++;
    }
    if (emitIdx < emitTimes.length) {
      const diff = send.sentAt - emitTimes[emitIdx];
      if (diff >= 0n) latencies.push(diff);
    }
  }

  // First-character latency (first emit to first send)
  let firstCharLatency = null;
  if (emitTimes.length > 0 && transport.sends.length > 0) {
    firstCharLatency =
      Number(transport.sends[0].sentAt - emitTimes[0]) / 1e6;
  }

  console.log(`\n=== ${label} ===`);
  console.log(`  Tokens emitted : ${emitTimes.length}`);
  console.log(`  Sends executed : ${transport.sends.length}`);
  console.log(`  Total bytes    : ${transport.totalBytes}`);
  if (firstCharLatency !== null) {
    console.log(`  First-char lat : ${firstCharLatency.toFixed(3)} ms`);
  }
  printStats('Chunk-to-wire', computeStats(latencies));

  return { firstCharLatency, stats: computeStats(latencies) };
}

// ---------------------------------------------------------------------------
// Run both benchmarks and compare with theoretical old behavior
// ---------------------------------------------------------------------------

async function main() {
  console.log('t140llm Latency Benchmark');
  console.log('========================');
  console.log(`Tokens: ${TOKENS.length}, interval: ${TOKEN_INTERVAL_MS}ms`);
  console.log(`Rate limit: 300 chars/sec (high, to isolate pipeline latency)`);

  const eeResult = await runBenchmark('EventEmitter Stream', () =>
    createEventEmitterStream(TOKENS, TOKEN_INTERVAL_MS)
  );

  const aiResult = await runBenchmark('AsyncIterable Stream', () =>
    createAsyncIterableStream(TOKENS, TOKEN_INTERVAL_MS)
  );

  console.log('\n=== Comparison ===');
  console.log('Old behavior (setInterval 100ms polling):');
  console.log('  First-char latency : 0-100ms (avg 50ms)');
  console.log('  Chunk-to-wire avg  : ~50ms');
  console.log('');
  console.log('New behavior (event-driven drain):');
  if (eeResult.firstCharLatency !== null) {
    console.log(
      `  EE first-char      : ${eeResult.firstCharLatency.toFixed(3)} ms`
    );
  }
  if (aiResult.firstCharLatency !== null) {
    console.log(
      `  AI first-char      : ${aiResult.firstCharLatency.toFixed(3)} ms`
    );
  }
  if (eeResult.stats) {
    console.log(
      `  EE chunk-to-wire   : ${eeResult.stats.avg.toFixed(3)} ms avg, ` +
      `${eeResult.stats.p99.toFixed(3)} ms p99`
    );
  }
  if (aiResult.stats) {
    console.log(
      `  AI chunk-to-wire   : ${aiResult.stats.avg.toFixed(3)} ms avg, ` +
      `${aiResult.stats.p99.toFixed(3)} ms p99`
    );
  }

  // Verdict
  const maxFirst = Math.max(
    eeResult.firstCharLatency ?? 0,
    aiResult.firstCharLatency ?? 0
  );
  const maxAvg = Math.max(
    eeResult.stats?.avg ?? 0,
    aiResult.stats?.avg ?? 0
  );

  console.log('');
  if (maxFirst < 5 && maxAvg < 10) {
    console.log('PASS: Event-driven drain is working correctly.');
    console.log(`  First-char < 5ms (was 0-100ms), avg < 10ms (was ~50ms).`);
  } else if (maxFirst < 20 && maxAvg < 30) {
    console.log('OK: Latency improved but higher than expected.');
    console.log('  May be due to system load or timer resolution.');
  } else {
    console.log('WARN: Latency higher than expected. Check implementation.');
  }
}

main().catch(console.error);
