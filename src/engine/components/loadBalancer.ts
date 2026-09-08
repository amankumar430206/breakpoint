import { z } from 'zod';
import { mm1 } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { num, str, type ComponentModel } from './types';

/**
 * Load balancer / reverse proxy. Forwards 100% of traffic, split across backends
 * by edge weight. Adds a small fixed processing latency and can itself saturate
 * if `capacityRps` is exceeded (modelled as a fast M/M/1).
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
  },
  paramSchema: z.object({
    algorithm: z.enum(['round-robin', 'least-conn', 'random']).default('round-robin'),
    latencyMs: z.number().nonnegative().default(1),
    capacityRps: z.number().positive().default(50000),
  }),
  paramDocs: {
    algorithm: 'Backend selection policy (affects tail latency in the simulator).',
    latencyMs: 'Fixed proxy processing latency added to every request.',
    capacityRps: 'Requests/sec the balancer itself can forward before it saturates.',
  },

  outflowFraction: () => 1,

  simSpec: (params) => ({
    servers: 1,
    serviceRate: num(params, 'capacityRps', 50000),
    queueCap: Infinity,
    fixedLatencySec: num(params, 'latencyMs', 1) / 1000,
    errorRate: 0,
    branchProb: 1,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const latencyMs = num(params, 'latencyMs', 1);
    const capacity = num(params, 'capacityRps', 50000);
    const qr = mm1(inflow, capacity);
    const base = metricsFromQueue(qr, {
      offered: inflow,
      capacity,
      servers: 1,
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
          formula: 'M/M/1 with μ = capacityRps, + fixed latencyMs',
        },
        {
          metric: 'rho',
          text: `Balancer utilization ρ = λ/capacity = ${inflow.toFixed(0)}/${capacity} = ${qr.rho.toFixed(3)} using ${str(params, 'algorithm', 'round-robin')} routing.`,
        },
      ],
    };
  },
};
