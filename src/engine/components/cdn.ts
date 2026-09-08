import { z } from 'zod';
import { mm1 } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { num, type ComponentModel } from './types';

/**
 * Content delivery network / edge cache. A fraction `offloadRatio` of requests
 * are served from an edge PoP in `edgeLatencyMs`; the rest fall through to the
 * origin. Routing is `branch`: outflowFraction = 1 − offloadRatio.
 */
export const cdnModel: ComponentModel = {
  type: 'cdn',
  label: 'CDN',
  category: 'network',
  routing: 'branch',
  handles: { in: true, out: true },
  defaultParams: {
    offloadRatio: 0.85,
    edgeLatencyMs: 15,
    edgeCapacityRps: 500000,
    intrinsicErrorRate: 0.0002,
  },
  paramSchema: z.object({
    offloadRatio: z.number().min(0).max(1).default(0.85),
    edgeLatencyMs: z.number().nonnegative().max(2000).default(15),
    edgeCapacityRps: z.number().positive().max(50000000).default(500000),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.0002),
  }),
  paramDocs: {
    offloadRatio: 'Share of requests served at the edge; the rest hit the origin.',
    edgeLatencyMs: 'Round-trip time for an edge hit.',
    edgeCapacityRps: 'Aggregate edge request rate before the CDN itself saturates.',
    intrinsicErrorRate: 'Baseline edge error rate.',
  },

  outflowFraction: (params) => 1 - num(params, 'offloadRatio', 0.85),

  simSpec: (params) => ({
    servers: 1,
    serviceRate: num(params, 'edgeCapacityRps', 500000),
    queueCap: Infinity,
    fixedLatencySec: num(params, 'edgeLatencyMs', 15) / 1000,
    errorRate: num(params, 'intrinsicErrorRate', 0.0002),
    branchProb: 1 - num(params, 'offloadRatio', 0.85),
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const offload = num(params, 'offloadRatio', 0.85);
    const missRate = 1 - offload;
    const cap = num(params, 'edgeCapacityRps', 500000);
    const qr = mm1(inflow, cap);
    const base = metricsFromQueue(qr, {
      offered: inflow,
      capacity: cap,
      servers: 1,
      intrinsicErrorRate: num(params, 'intrinsicErrorRate', 0.0002),
      downstreamErrorRate: downstreamErrorRate * missRate,
    });
    return {
      metrics: addLatency(base, num(params, 'edgeLatencyMs', 15) / 1000),
      explain: [
        {
          metric: 'arrivalRate',
          text: `${(offload * 100).toFixed(0)}% served at the edge ⇒ origin sees ${(inflow * missRate).toFixed(0)} of ${inflow.toFixed(0)} req/s.`,
          formula: 'λ_origin = λ · (1 − offloadRatio)',
          dominantTerm: 'offloadRatio',
        },
      ],
    };
  },
};
