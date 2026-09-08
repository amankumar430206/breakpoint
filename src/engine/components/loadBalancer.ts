import { z } from 'zod';
import { mmc } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { num, str, type ComponentModel } from './types';

/**
 * Load balancer / reverse proxy. Forwards 100% of traffic, split across backends
 * by edge weight. Adds a small fixed processing latency. The balancer tier can
 * itself saturate if `capacityRps` is exceeded — run `instances` of it
 * (active-active) to raise that ceiling and remove the single point of failure.
 * Modelled as one M/M/c pool with c = instances, μ = capacityRps.
 */
export const loadBalancerModel: ComponentModel = {
  type: 'loadBalancer',
  label: 'Load Balancer',
  category: 'network',
  routing: 'passthrough',
  handles: { in: true, out: true },
  defaultParams: {
    algorithm: 'round-robin',
    latencyMs: 1,
    capacityRps: 50000,
    instances: 1,
  },
  paramSchema: z.object({
    algorithm: z.enum(['round-robin', 'least-conn', 'random']).default('round-robin'),
    latencyMs: z.number().nonnegative().default(1),
    capacityRps: z.number().positive().max(10000000).default(50000),
    instances: z.number().int().positive().max(64).default(1),
  }),
  paramDocs: {
    algorithm: 'Backend selection policy (affects tail latency in the simulator).',
    latencyMs: 'Fixed proxy processing latency added to every request.',
    capacityRps: 'Requests/sec ONE balancer instance can forward before it saturates.',
    instances: 'Redundant balancer instances sharing the load (active-active) — also removes the single point of failure.',
  },

  scaleParam: { key: 'instances', label: 'instances', min: 1, max: 64 },

  presets: [
    { label: '20k', hint: 'Small proxy box — nginx / HAProxy on 1–2 vCPU', patch: { capacityRps: 20000 } },
    { label: '50k', hint: 'Proxy box — 4 vCPU, tuned', patch: { capacityRps: 50000 } },
    { label: '100k', hint: 'Large proxy — 8 vCPU HAProxy', patch: { capacityRps: 100000 } },
    { label: '500k', hint: 'Managed L7 — ALB / Application Gateway (scales out)', patch: { capacityRps: 500000 } },
    { label: '2M', hint: 'Managed L4 — NLB / connection-based (effectively uncapped)', patch: { capacityRps: 2000000 } },
  ],

  outflowFraction: () => 1,

  simSpec: (params) => ({
    servers: Math.max(1, Math.round(num(params, 'instances', 1))),
    serviceRate: num(params, 'capacityRps', 50000),
    queueCap: Infinity,
    fixedLatencySec: num(params, 'latencyMs', 1) / 1000,
    errorRate: 0,
    branchProb: 1,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const latencyMs = num(params, 'latencyMs', 1);
    const perInstance = num(params, 'capacityRps', 50000);
    const n = Math.max(1, Math.round(num(params, 'instances', 1)));
    const capacity = perInstance * n;
    const qr = mmc(inflow, perInstance, n);
    const base = metricsFromQueue(qr, {
      offered: inflow,
      capacity,
      servers: n,
      intrinsicErrorRate: 0,
      downstreamErrorRate,
    });
    const metrics = addLatency(base, latencyMs / 1000);
    return {
      metrics,
      explain: [
        {
          metric: 'latency.mean',
          text: `Adds a fixed ${latencyMs} ms hop; queueing here is negligible until load nears ${capacity.toLocaleString()} req/s (ρ=${qr.rho.toFixed(2)}).`,
          formula: 'M/M/c with c = instances, μ = capacityRps, + fixed latencyMs',
        },
        {
          metric: 'rho',
          text:
            n > 1
              ? `${n} instances × ${perInstance.toLocaleString()} req/s ⇒ ρ = λ/(n·capacity) = ${inflow.toFixed(0)}/${capacity.toLocaleString()} = ${qr.rho.toFixed(3)} (${str(params, 'algorithm', 'round-robin')}).`
              : `Balancer utilization ρ = λ/capacity = ${inflow.toFixed(0)}/${capacity.toLocaleString()} = ${qr.rho.toFixed(3)} using ${str(params, 'algorithm', 'round-robin')} routing.`,
        },
      ],
    };
  },
};
