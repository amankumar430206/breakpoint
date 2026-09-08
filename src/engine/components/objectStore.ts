import { z } from 'zod';
import { mm1 } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { idleMetrics, num, type ComponentModel } from './types';

/**
 * Blob / object storage (S3, R2, GCS). Effectively unlimited capacity with a
 * fixed latency floor per operation. Almost never the bottleneck for request
 * rate — it's here to model the latency it adds and its independent error rate.
 * Routing is `sink`.
 */
export const objectStoreModel: ComponentModel = {
  type: 'objectStore',
  label: 'Object Store',
  category: 'data',
  routing: 'sink',
  handles: { in: true, out: false },
  defaultParams: {
    opLatencyMs: 25,
    opsRps: 200000,
    intrinsicErrorRate: 0.0005,
  },
  paramSchema: z.object({
    opLatencyMs: z.number().nonnegative().max(5000).default(25),
    opsRps: z.number().positive().max(20000000).default(200000),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.0005),
  }),
  paramDocs: {
    opLatencyMs: 'Round-trip time for a GET/PUT.',
    opsRps: 'Requests/sec before the account/bucket is throttled.',
    intrinsicErrorRate: 'Baseline storage error rate.',
  },

  outflowFraction: () => 0,

  simSpec: (params) => ({
    servers: 1,
    serviceRate: num(params, 'opsRps', 200000),
    queueCap: Infinity,
    fixedLatencySec: num(params, 'opLatencyMs', 25) / 1000,
    errorRate: num(params, 'intrinsicErrorRate', 0.0005),
    branchProb: 0,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    if (inflow <= 0) return { metrics: idleMetrics(1), explain: [] };
    const cap = num(params, 'opsRps', 200000);
    const qr = mm1(inflow, cap);
    const base = metricsFromQueue(qr, {
      offered: inflow,
      capacity: cap,
      servers: 1,
      intrinsicErrorRate: num(params, 'intrinsicErrorRate', 0.0005),
      downstreamErrorRate,
    });
    return {
      metrics: addLatency(base, num(params, 'opLatencyMs', 25) / 1000),
      explain: [
        {
          metric: 'latency.mean',
          text: `Adds a ~${num(params, 'opLatencyMs', 25)} ms floor per object op; capacity (${cap.toLocaleString()} ops/s) is rarely the constraint.`,
          dominantTerm: 'fixed op latency',
        },
      ],
    };
  },
};
