import { z } from 'zod';
import { mmc } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import type { ExplainNote } from '../types';
import { idleMetrics, num, str, type ComponentModel } from './types';

/**
 * Stream processor — Flink / Kafka Streams / Spark Structured Streaming. Reads a
 * record stream (usually off a `pubsubTopic` or `queue`), does stateful,
 * windowed work across `parallelism` task slots, and periodically checkpoints.
 *
 *  - keyed **state** lives on the heap (fast, RAM-bound) or in RocksDB
 *    (disk-backed — large state is fine, but lookups are ~1.5–1.8× slower);
 *  - every `checkpointSec` the pipeline stalls for `checkpointStallMs` to align
 *    barriers and snapshot — amortised over the interval, that adds a small
 *    fixed latency to every record.
 */
export const streamProcessorModel: ComponentModel = {
  type: 'streamProcessor',
  label: 'Stream Processor',
  category: 'compute',
  routing: 'passthrough',
  handles: { in: true, out: true },
  defaultParams: {
    recordServiceMs: 3,
    parallelism: 4,
    stateBackend: 'rocksdb',
    stateGB: 4,
    checkpointSec: 30,
    checkpointStallMs: 200,
    intrinsicErrorRate: 0.002,
  },
  paramSchema: z.object({
    recordServiceMs: z.number().positive().max(60000).default(3),
    parallelism: z.number().int().min(1).max(4096).default(4),
    stateBackend: z.enum(['heap', 'rocksdb']).default('rocksdb'),
    stateGB: z.number().nonnegative().max(100000).default(4),
    checkpointSec: z.number().positive().max(3600).default(30),
    checkpointStallMs: z.number().nonnegative().max(60000).default(200),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.002),
  }),
  paramDocs: {
    recordServiceMs: 'Base processing time per record (before state-backend cost).',
    parallelism: 'Task slots / subtasks — the throughput knob.',
    stateBackend: 'heap = fast, RAM-bound; rocksdb = disk-backed, slower lookups, large state OK.',
    stateGB: 'Keyed state size — big RocksDB state slows lookups; big heap state risks GC / OOM.',
    checkpointSec: 'Interval between checkpoints.',
    checkpointStallMs: 'Pipeline stall per checkpoint (barrier alignment + snapshot).',
    intrinsicErrorRate: 'Baseline processing error rate.',
  },
  scaleParam: { key: 'parallelism', label: 'parallelism', min: 1, max: 512 },

  presetLegend: 'task slots (parallelism)',
  presets: [
    { label: '2', hint: 'Small job', patch: { parallelism: 2 } },
    { label: '8', hint: 'Standard job', patch: { parallelism: 8 } },
    { label: '32', hint: 'High-throughput job', patch: { parallelism: 32 } },
    { label: '128', hint: 'Large cluster', patch: { parallelism: 128 } },
  ],

  outflowFraction: () => 1,

  simSpec: (params) => ({
    servers: Math.max(1, Math.round(num(params, 'parallelism', 4))),
    serviceRate: 1000 / effRecordMs(params),
    queueCap: Infinity, // the stream buffers upstream
    fixedLatencySec: checkpointOverheadSec(params),
    errorRate: num(params, 'intrinsicErrorRate', 0.002),
    branchProb: 1,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const c = Math.max(1, Math.round(num(params, 'parallelism', 4)));
    if (inflow <= 0) return { metrics: idleMetrics(c), explain: [] };

    const recMs = effRecordMs(params);
    const mu = 1000 / recMs;
    const qr = mmc(inflow, mu, c);
    const base = metricsFromQueue(qr, {
      offered: inflow,
      capacity: c * mu,
      servers: c,
      intrinsicErrorRate: num(params, 'intrinsicErrorRate', 0.002),
      downstreamErrorRate,
    });
    const ckptSec = checkpointOverheadSec(params);
    const metrics = addLatency(base, ckptSec);

    const backend = str(params, 'stateBackend', 'rocksdb');
    const stateGB = num(params, 'stateGB', 4);
    const explain: ExplainNote[] = [
      {
        metric: 'rho',
        text: `${c} task slot(s) × ~${recMs.toFixed(1)} ms/record (${backend}${backend === 'rocksdb' && stateGB > 5 ? `, ${stateGB} GB state` : ''}) ⇒ capacity ≈ ${(c * mu).toFixed(0)} records/s. ρ = ${qr.rho.toFixed(3)}. Add parallelism to scale.`,
        formula: 'M/M/c, c = parallelism, μ = 1 / recordServiceMs·stateFactor',
        dominantTerm: qr.rho > 0.85 ? 'parallelism' : 'record processing time',
      },
      {
        metric: 'latency.mean',
        text: `Checkpoint every ${num(params, 'checkpointSec', 30)}s stalls ${num(params, 'checkpointStallMs', 200)} ms — amortised, +${(ckptSec * 1000).toFixed(1)} ms per record. Longer intervals or incremental checkpoints reduce it.`,
      },
    ];
    if (backend === 'heap' && stateGB > 8) {
      explain.push({
        metric: 'rho',
        text: `${stateGB} GB of heap state — watch GC pauses and OOM. Switch to the RocksDB backend for state this large.`,
        dominantTerm: 'heap state pressure',
      });
    }
    return { metrics, explain };
  },
};

function effRecordMs(params: Record<string, unknown>): number {
  const base = Math.max(0.001, num(params, 'recordServiceMs', 3));
  if (str(params, 'stateBackend', 'rocksdb') !== 'rocksdb') return base;
  // RocksDB lookups cost more as the on-disk state grows.
  const factor = 1 + Math.min(1, num(params, 'stateGB', 4) / 50) * 0.8;
  return base * factor;
}

function checkpointOverheadSec(params: Record<string, unknown>): number {
  const stallMs = num(params, 'checkpointStallMs', 200);
  const intervalMs = num(params, 'checkpointSec', 30) * 1000;
  return (stallMs * stallMs) / (intervalMs + stallMs) / 1000;
}
