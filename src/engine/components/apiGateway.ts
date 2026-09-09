import { z } from 'zod';
import { clamp01 } from './util';
import { idleMetrics, num, type ComponentModel } from './types';

/**
 * API gateway / edge — the real front door in front of the app tier. It does
 * three things a plain load balancer doesn't:
 *
 *  - **auth** — verifies a token (JWT locally, or an introspection call),
 *    adding `authLatencyMs` to every request and rejecting `authErrorRate` of
 *    them as 401/403;
 *  - **rate limiting / quota** — admits at most `rateLimitRps`; the excess comes
 *    back 429 and never reaches the backend (that is the point — it shields it);
 *  - **routing / aggregation** — fan-out to several services is expressed with
 *    `callsPerRequest` on the outgoing edges.
 *
 * Modelled as a gate at the binding rate — the lower of the fleet's forwarding
 * capacity (`instances · capacityRps`) and the admission limit (`rateLimitRps`).
 * Routing is `passthrough`; `outflowFraction` drops the 429 fraction so the
 * backend sees only the admitted rate.
 */
export const apiGatewayModel: ComponentModel = {
  type: 'apiGateway',
  label: 'API Gateway',
  category: 'network',
  routing: 'passthrough',
  handles: { in: true, out: true },
  defaultParams: {
    capacityRps: 50000,
    instances: 1,
    authLatencyMs: 3,
    rateLimitRps: 10000,
    authErrorRate: 0.001,
  },
  paramSchema: z.object({
    capacityRps: z.number().positive().max(10000000).default(50000),
    instances: z.number().int().positive().max(64).default(1),
    authLatencyMs: z.number().nonnegative().max(5000).default(3),
    rateLimitRps: z.number().positive().max(10000000).default(10000),
    authErrorRate: z.number().min(0).max(1).default(0.001),
  }),
  paramDocs: {
    capacityRps: 'Requests/sec ONE gateway instance can process before it saturates.',
    instances: 'Redundant gateway instances sharing the load (active-active).',
    authLatencyMs: 'Added to every request for token verification / introspection.',
    rateLimitRps: 'Admission ceiling — requests above this come back 429 and never reach the backend.',
    authErrorRate: 'Fraction of requests rejected at auth (401 / 403).',
  },

  scaleParam: { key: 'instances', label: 'instances', min: 1, max: 64 },

  presetLegend: 'per-instance capacity (req/s)',
  presets: [
    { label: '20k', hint: 'Kong / Envoy on 2 vCPU', patch: { capacityRps: 20000 } },
    { label: '50k', hint: 'Tuned gateway, 4 vCPU', patch: { capacityRps: 50000 } },
    { label: '150k', hint: 'Large gateway fleet member, 8 vCPU', patch: { capacityRps: 150000 } },
    { label: '500k', hint: 'Managed edge — API Gateway / Cloudflare (scales out)', patch: { capacityRps: 500000 } },
  ],

  outflowFraction: (params, ctx) => {
    const inflow = ctx?.inflow ?? 0;
    if (inflow <= 0) return 1;
    const eff = bindingRate(params);
    return Math.min(1, eff / inflow);
  },

  simSpec: (params) => {
    const eff = bindingRate(params);
    return {
      // a gate: `eff` slots at ~1 rps each ⇒ throughput ≈ eff, queueCap 0 ⇒
      // everything over the limit is a 429 (same trick as externalService)
      servers: Math.max(1, Math.round(eff)),
      serviceRate: 1,
      queueCap: 0,
      fixedLatencySec: num(params, 'authLatencyMs', 3) / 1000,
      errorRate: num(params, 'authErrorRate', 0.001),
      branchProb: 1,
    };
  },

  solve: ({ params, inflow, downstreamErrorRate }) => {
    if (inflow <= 0) return { metrics: idleMetrics(1), explain: [] };

    const eff = bindingRate(params);
    const rateLimited = num(params, 'rateLimitRps', 10000) <= fleetCapacity(params);
    const authLat = num(params, 'authLatencyMs', 3) / 1000;
    const authErr = num(params, 'authErrorRate', 0.001);

    const served = Math.min(inflow, eff);
    const shed = 1 - served / inflow; // 429s
    const rho = inflow / eff;
    const overloaded = rho >= 1;
    const errorRate = clamp01(1 - (1 - authErr) * (1 - clamp01(downstreamErrorRate)));

    return {
      metrics: {
        arrivalRate: inflow,
        throughput: served * (1 - errorRate),
        rho,
        servers: Math.round(eff),
        inSystem: served * authLat,
        inQueue: 0,
        latency: { mean: authLat, p50: authLat, p95: authLat, p99: authLat },
        dropRate: shed,
        errorRate,
        stable: !overloaded,
        overloaded,
        backlogGrowth: overloaded ? Math.max(0, inflow - eff) : 0,
      },
      explain: [
        {
          metric: 'dropRate',
          text: overloaded
            ? `${inflow.toFixed(0)} req/s against a ${eff.toFixed(0)} req/s ${rateLimited ? 'rate limit' : 'processing ceiling'} — ${(shed * 100).toFixed(0)}% come back 429 and never reach the backend.`
            : `Admitting ${served.toFixed(0)} req/s (${(rho * 100).toFixed(0)}% of the ${eff.toFixed(0)} req/s ${rateLimited ? 'rate limit' : 'capacity'}).`,
          formula: 'admitted = min(λ, min(instances·capacityRps, rateLimitRps))',
          dominantTerm: rateLimited ? 'rate limit' : 'gateway capacity',
        },
        {
          metric: 'latency.mean',
          text: `Auth adds a flat ~${num(params, 'authLatencyMs', 3)} ms to every request; queueing here is negligible (it sheds instead of buffering).`,
        },
      ],
    };
  },
};

function fleetCapacity(params: Record<string, unknown>): number {
  return (
    Math.max(1, num(params, 'capacityRps', 50000)) *
    Math.max(1, Math.round(num(params, 'instances', 1)))
  );
}

/** The binding rate: the lower of fleet forwarding capacity and the admission limit. */
function bindingRate(params: Record<string, unknown>): number {
  return Math.min(fleetCapacity(params), Math.max(1, num(params, 'rateLimitRps', 10000)));
}
