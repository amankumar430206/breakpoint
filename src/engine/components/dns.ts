import { z } from 'zod';
import { mm1 } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { idleMetrics, num, str, type ComponentModel } from './types';

/**
 * DNS / global traffic manager — Route 53, Cloudflare, Akamai GTM, Azure Traffic
 * Manager. The very first hop: it resolves a name to an endpoint, optionally by
 * geo / latency / health. Almost all resolutions are served from a client or
 * resolver cache (`cacheHitRatio`), so it is never the bottleneck — its job is
 * routing and failover, not throughput.
 *
 * `ttlSec` + `healthCheckSec` set how fast a bad region is routed away from.
 */
export const dnsModel: ComponentModel = {
  type: 'dns',
  label: 'DNS / Traffic Manager',
  category: 'network',
  routing: 'passthrough',
  handles: { in: true, out: true },
  defaultParams: {
    routingPolicy: 'latency',
    resolveLatencyMs: 1,
    cacheHitRatio: 0.95,
    ttlSec: 60,
    healthCheckSec: 10,
    capacityRps: 5000000,
  },
  paramSchema: z.object({
    routingPolicy: z.enum(['simple', 'geo', 'latency', 'failover', 'weighted']).default('latency'),
    resolveLatencyMs: z.number().nonnegative().max(10000).default(1),
    cacheHitRatio: z.number().min(0).max(1).default(0.95),
    ttlSec: z.number().positive().max(86400).default(60),
    healthCheckSec: z.number().positive().max(3600).default(10),
    capacityRps: z.number().positive().max(1000000000).default(5000000),
  }),
  paramDocs: {
    routingPolicy: 'simple = one endpoint (no failover); geo / latency / failover / weighted route across regions.',
    resolveLatencyMs: 'Uncached resolution time (most lookups are cached).',
    cacheHitRatio: 'Resolutions answered from a client / resolver cache (0 latency).',
    ttlSec: 'Record TTL — lower = faster failover, more lookup traffic.',
    healthCheckSec: 'Health-check interval — sets failover detection time.',
    capacityRps: 'Resolutions/sec the service can answer (effectively uncapped).',
  },

  presetLegend: 'uncached resolution (ms)',
  presets: [
    { label: '0', hint: 'Fully cached / anycast', patch: { resolveLatencyMs: 0 } },
    { label: '1', hint: 'Typical', patch: { resolveLatencyMs: 1 } },
    { label: '20', hint: 'Cold / cross-region', patch: { resolveLatencyMs: 20 } },
  ],

  outflowFraction: () => 1,

  simSpec: (params) => ({
    servers: 1,
    serviceRate: num(params, 'capacityRps', 5000000),
    queueCap: Infinity,
    fixedLatencySec: blendedSec(params),
    errorRate: 0,
    branchProb: 1,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    if (inflow <= 0) return { metrics: idleMetrics(1), explain: [] };
    const cap = num(params, 'capacityRps', 5000000);
    const qr = mm1(inflow, cap);
    const base = metricsFromQueue(qr, {
      offered: inflow,
      capacity: cap,
      servers: 1,
      intrinsicErrorRate: 0,
      downstreamErrorRate,
    });
    const metrics = addLatency(base, blendedSec(params));

    const policy = str(params, 'routingPolicy', 'latency');
    const failoverSec = num(params, 'healthCheckSec', 10) + num(params, 'ttlSec', 60);
    return {
      metrics,
      explain: [
        {
          metric: 'latency.mean',
          text: `${((1 - num(params, 'cacheHitRatio', 0.95)) * 100).toFixed(0)}% of lookups are uncached (~${num(params, 'resolveLatencyMs', 1)} ms); the rest are free. Never the bottleneck — this hop is about routing, not throughput.`,
        },
        {
          metric: 'rho',
          text:
            policy === 'simple'
              ? `Policy "simple" — one endpoint, no failover. A region / origin outage is a total outage until you change the record.`
              : `Policy "${policy}" — routes away from an unhealthy region in ~${failoverSec.toFixed(0)}s (healthCheck ${num(params, 'healthCheckSec', 10)}s + TTL ${num(params, 'ttlSec', 60)}s). Lower the TTL for faster failover.`,
        },
      ],
    };
  },
};

function blendedSec(params: Record<string, unknown>): number {
  return (1 - num(params, 'cacheHitRatio', 0.95)) * (num(params, 'resolveLatencyMs', 1) / 1000);
}
