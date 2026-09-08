import { z } from 'zod';
import { idleMetrics, num, type ComponentModel } from './types';

/**
 * A third-party dependency you don't control — a payment gateway, an SMS/email
 * provider, someone else's API. You can't scale it; you can only put a cache, a
 * queue, or a circuit breaker in front. Modelled as a fixed-latency service with
 * a hard rate limit: traffic above `rateLimitRps` is rejected (429). Routing is
 * `sink`.
 */
export const externalServiceModel: ComponentModel = {
  type: 'externalService',
  label: 'External Service',
  category: 'external',
  routing: 'sink',
  handles: { in: true, out: false },
  defaultParams: {
    latencyMs: 120,
    jitterMs: 80,
    rateLimitRps: 500,
    errorRate: 0.01,
    timeoutSec: 5,
  },
  paramSchema: z.object({
    latencyMs: z.number().nonnegative().max(60000).default(120),
    jitterMs: z.number().nonnegative().max(60000).default(80),
    rateLimitRps: z.number().positive().default(500),
    errorRate: z.number().min(0).max(1).default(0.01),
    timeoutSec: z.number().positive().max(120).default(5),
  }),
  paramDocs: {
    latencyMs: 'Their typical response time (p50).',
    jitterMs: 'Response-time spread — drives the tail (p99 ≈ latency + 3·jitter).',
    rateLimitRps: 'Requests/sec they allow before returning 429.',
    errorRate: 'Their baseline error rate (5xx / failures).',
    timeoutSec: 'Your client timeout on calls to them.',
  },

  outflowFraction: () => 0,

  simSpec: (params) => {
    const limit = num(params, 'rateLimitRps', 500);
    return {
      // effectively unbounded concurrency, but a bounded accept rate → model the
      // rate limit as a single fast "gate" with queueCap 0 (excess is rejected)
      servers: Math.max(1, Math.round(limit)),
      serviceRate: 1, // each slot ~1 rps → `servers` slots ≈ rateLimitRps
      queueCap: 0,
      fixedLatencySec: num(params, 'latencyMs', 120) / 1000,
      errorRate: num(params, 'errorRate', 0.01),
      branchProb: 0,
    };
  },

  solve: ({ params, inflow }) => {
    if (inflow <= 0) return { metrics: idleMetrics(1), explain: [] };
    const limit = num(params, 'rateLimitRps', 500);
    const latency = num(params, 'latencyMs', 120) / 1000;
    const jitter = num(params, 'jitterMs', 80) / 1000;
    const intrinsicErr = num(params, 'errorRate', 0.01);

    const served = Math.min(inflow, limit);
    const dropRate = inflow > 0 ? 1 - served / inflow : 0; // 429s
    const rho = inflow / limit;
    const throttled = rho >= 1;

    return {
      metrics: {
        arrivalRate: inflow,
        throughput: served * (1 - intrinsicErr),
        rho,
        servers: Math.round(limit),
        inSystem: served * latency,
        inQueue: 0,
        latency: {
          mean: latency,
          p50: latency,
          p95: latency + 2 * jitter,
          p99: latency + 3 * jitter,
        },
        dropRate,
        errorRate: intrinsicErr,
        stable: !throttled,
        overloaded: throttled,
        backlogGrowth: throttled ? Math.max(0, inflow - limit) : 0,
      },
      explain: [
        {
          metric: 'dropRate',
          text: throttled
            ? `Calling ${inflow.toFixed(0)} req/s at a ${limit.toFixed(0)} req/s limit — ${(dropRate * 100).toFixed(0)}% come back 429. You can't scale them; cache responses or queue the calls.`
            : `Under the ${limit.toFixed(0)} req/s rate limit (${(rho * 100).toFixed(0)}% of it).`,
          dominantTerm: 'their rate limit',
        },
        {
          metric: 'latency.p99',
          text: `Fixed ~${num(params, 'latencyMs', 120)} ms ± ${num(params, 'jitterMs', 80)} ms; your ${num(params, 'timeoutSec', 5)} s timeout ${latency + 3 * jitter > num(params, 'timeoutSec', 5) ? 'will fire on the tail' : 'has margin'}.`,
        },
      ],
    };
  },
};
