import { z } from 'zod';
import { mm1 } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { num, type ComponentModel } from './types';

/**
 * Pub/Sub topic — Kafka topic / SNS / Google Pub/Sub. Unlike a work `queue`
 * (point-to-point, one consumer takes each message), a topic **fans out**: every
 * one of `consumerGroups` independent subscribers receives the *full* published
 * stream, each tracking its own offset / lag.
 *
 * That is the only real difference from `queue` — `routing: 'replicate'`, so each
 * outgoing edge (one per consumer group) carries 100% of the publish rate. The
 * enqueue itself is a cheap M/M/1 at `throughputRps`; `partitions` caps how much
 * consumer parallelism each group can bring to bear (a note, not a limit here).
 * Per-group lag shows up as ρ on the downstream `worker` / `streamProcessor`.
 */
export const pubsubTopicModel: ComponentModel = {
  type: 'pubsubTopic',
  label: 'Pub/Sub Topic',
  category: 'messaging',
  routing: 'replicate',
  handles: { in: true, out: true },
  defaultParams: {
    throughputRps: 50000,
    partitions: 6,
    consumerGroups: 2,
    retentionSec: 604800,
    enqueueLatencyMs: 2,
  },
  paramSchema: z.object({
    throughputRps: z.number().positive().max(50000000).default(50000),
    partitions: z.number().int().positive().max(4096).default(6),
    consumerGroups: z.number().int().positive().max(64).default(2),
    retentionSec: z.number().positive().default(604800),
    enqueueLatencyMs: z.number().nonnegative().max(2000).default(2),
  }),
  paramDocs: {
    throughputRps: 'Messages/sec the topic can accept before it saturates.',
    partitions: 'Partitions — the max consumer parallelism available to each group.',
    consumerGroups: 'Independent subscribers; every group receives the whole stream.',
    retentionSec: 'How long messages are kept for replay / slow consumers.',
    enqueueLatencyMs: 'Time to accept and persist one published message.',
  },

  presetLegend: 'publish throughput (msg/s)',
  presets: [
    { label: '10k', hint: 'Single-broker topic / light SNS use', patch: { throughputRps: 10000 } },
    { label: '50k', hint: '3-broker Kafka topic, 6 partitions', patch: { throughputRps: 50000 } },
    { label: '200k', hint: 'Tuned Kafka / Kinesis, many partitions', patch: { throughputRps: 200000 } },
    { label: '1M', hint: 'Large managed stream', patch: { throughputRps: 1000000 } },
  ],

  outflowFraction: () => 1,

  simSpec: (params) => ({
    servers: 1,
    serviceRate: num(params, 'throughputRps', 50000),
    queueCap: Infinity, // retention is the buffer
    fixedLatencySec: num(params, 'enqueueLatencyMs', 2) / 1000,
    errorRate: 0,
    branchProb: 1,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const cap = num(params, 'throughputRps', 50000);
    const groups = Math.max(1, Math.round(num(params, 'consumerGroups', 2)));
    const parts = Math.max(1, Math.round(num(params, 'partitions', 6)));
    const qr = mm1(inflow, cap);
    const base = metricsFromQueue(qr, {
      offered: inflow,
      capacity: cap,
      servers: 1,
      intrinsicErrorRate: 0,
      downstreamErrorRate,
    });
    return {
      metrics: addLatency(base, num(params, 'enqueueLatencyMs', 2) / 1000),
      explain: [
        {
          metric: 'arrivalRate',
          text: `Fan-out: each of ${groups} consumer group(s) receives the full ${inflow.toFixed(0)} msg/s — total downstream delivery is ${(inflow * groups).toFixed(0)} msg/s.`,
          formula: 'λ_per_group = λ_publish (replicate)',
        },
        {
          metric: 'latency.mean',
          text: `Publish is ~${num(params, 'enqueueLatencyMs', 2)} ms. Each group can spread work across ${parts} partition(s); sustained lag shows on that group's consumer, not here.`,
          dominantTerm: 'consumer drain rate',
        },
      ],
    };
  },
};
