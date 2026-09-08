import { z } from 'zod';
import { mm1 } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { num, type ComponentModel } from './types';

/**
 * Look-aside cache (Redis/Memcached). A fraction `hitRatio` of requests are
 * served from memory in `hitLatencyMs`; the rest (`1 − hitRatio`) fall through to
 * the downstream origin. The lookup itself is a very fast M/M/1 that can still
 * saturate at extreme RPS.
 *
 * Routing is `branch`: outflowFraction = 1 − hitRatio.
 */
export const cacheModel: ComponentModel = {
  type: 'cache',
  label: 'Cache',
  category: 'data',
  routing: 'branch',
  handles: { in: true, out: true },
  defaultParams: {
    hitRatio: 0.8,
    hitLatencyMs: 1,
    capacityRps: 120000,
    intrinsicErrorRate: 0.0001,
  },
  paramSchema: z.object({
    hitRatio: z.number().min(0).max(1).default(0.8),
    hitLatencyMs: z.number().nonnegative().default(1),
    capacityRps: z.number().positive().max(10000000).default(120000),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.0001),
  }),
  paramDocs: {
    hitRatio: 'Share of requests served from cache; misses fall through downstream.',
    hitLatencyMs: 'Round-trip time for a cache hit.',
    capacityRps: 'Operations/sec the cache can serve before it saturates.',
    intrinsicErrorRate: 'Baseline cache error/unavailability rate.',
  },

  presets: [
    { label: '50k', hint: 'cache.t3.medium — small Redis / Memcached node', patch: { capacityRps: 50000 } },
    { label: '120k', hint: 'cache.m6g.large', patch: { capacityRps: 120000 } },
    { label: '250k', hint: 'cache.m6g.xlarge', patch: { capacityRps: 250000 } },
    { label: '600k', hint: 'cache.r6g.2xlarge / clustered', patch: { capacityRps: 600000 } },
  ],

  outflowFraction: (params) => 1 - num(params, 'hitRatio', 0.8),

  simSpec: (params) => ({
    servers: 1,
    serviceRate: num(params, 'capacityRps', 120000),
    queueCap: Infinity,
    fixedLatencySec: num(params, 'hitLatencyMs', 1) / 1000,
    errorRate: num(params, 'intrinsicErrorRate', 0.0001),
    branchProb: 1 - num(params, 'hitRatio', 0.8),
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const hitRatio = num(params, 'hitRatio', 0.8);
    const hitMs = num(params, 'hitLatencyMs', 1);
    const capacity = num(params, 'capacityRps', 120000);
    const missRate = 1 - hitRatio;

    const qr = mm1(inflow, capacity);
    const base = metricsFromQueue(qr, {
      offered: inflow,
      capacity,
      servers: 1,
      intrinsicErrorRate: num(params, 'intrinsicErrorRate', 0.0001),
      // only the miss fraction is exposed to downstream failures
      downstreamErrorRate: downstreamErrorRate * missRate,
    });
    const metrics = addLatency(base, hitMs / 1000);

    return {
      metrics,
      explain: [
        {
          metric: 'arrivalRate',
          text: `Hit ratio ${(hitRatio * 100).toFixed(0)}% ⇒ only ${(missRate * 100).toFixed(0)}% (${(inflow * missRate).toFixed(0)} req/s) reaches the origin.`,
          formula: 'λ_downstream = λ · (1 − hitRatio)',
        },
        {
          metric: 'latency.mean',
          text: `Cache-hit path returns in ~${hitMs} ms; removing this cache would push ${(inflow * missRate).toFixed(0)} → ${inflow.toFixed(0)} req/s onto the origin.`,
          dominantTerm: 'hitRatio',
        },
      ],
    };
  },
};
