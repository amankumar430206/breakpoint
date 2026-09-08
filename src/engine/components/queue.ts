import { z } from 'zod';
import { mm1 } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { num, type ComponentModel } from './types';

/**
 * Message queue / broker (Kafka, SQS, BullMQ). Decouples producers from
 * consumers: it buffers work and forwards it to downstream workers. Enqueue is
 * cheap and fast; the real constraint is downstream consumer capacity — if the
 * workers can't keep up, the backlog grows (visible on the worker node and in
 * the simulator under a spike).
 */
export const queueModel: ComponentModel = {
  type: 'queue',
  label: 'Queue',
  category: 'messaging',
  routing: 'passthrough',
  handles: { in: true, out: true },
  defaultParams: {
    enqueueLatencyMs: 2,
    brokerThroughputRps: 50000,
    partitions: 3,
    retentionSec: 604800,
  },
  paramSchema: z.object({
    enqueueLatencyMs: z.number().nonnegative().max(2000).default(2),
    brokerThroughputRps: z.number().positive().default(50000),
    partitions: z.number().int().positive().max(1024).default(3),
    retentionSec: z.number().positive().default(604800),
  }),
  paramDocs: {
    enqueueLatencyMs: 'Time to accept and persist one message.',
    brokerThroughputRps: 'Messages/sec the broker can accept before it saturates.',
    partitions: 'Parallelism available to consumers.',
    retentionSec: 'How long unconsumed messages are kept before they age out.',
  },

  outflowFraction: () => 1,

  simSpec: (params) => ({
    servers: 1,
    serviceRate: num(params, 'brokerThroughputRps', 50000),
    queueCap: Infinity, // the queue IS the buffer
    fixedLatencySec: num(params, 'enqueueLatencyMs', 2) / 1000,
    errorRate: 0,
    branchProb: 1,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const cap = num(params, 'brokerThroughputRps', 50000);
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
          metric: 'latency.mean',
          text: `Enqueue is ~${num(params, 'enqueueLatencyMs', 2)} ms. The queue absorbs bursts across ${num(params, 'partitions', 3)} partitions — sustained backlog shows on the consumer, not here.`,
          dominantTerm: 'consumer drain rate',
        },
      ],
    };
  },
};
