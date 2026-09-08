import { z } from 'zod';
import type { ComponentModel } from './types';
import { idleMetrics } from './types';

/**
 * Client / traffic source. The flow solver injects the scenario's arrival rate
 * here; the node itself adds no latency and never drops. Multiple outgoing edges
 * split the traffic by weight.
 */
export const clientModel: ComponentModel = {
  type: 'client',
  label: 'Client',
  category: 'source',
  routing: 'passthrough',
  handles: { in: false, out: true },
  defaultParams: {},
  paramSchema: z.object({}).passthrough(),
  paramDocs: {},

  outflowFraction: () => 1,

  simSpec: () => ({
    servers: Infinity,
    serviceRate: Infinity,
    queueCap: Infinity,
    fixedLatencySec: 0,
    errorRate: 0,
    branchProb: 1,
  }),

  solve: ({ inflow }) => {
    const m = idleMetrics(1);
    m.arrivalRate = inflow;
    m.throughput = inflow;
    return {
      metrics: m,
      explain: [
        {
          metric: 'arrivalRate',
          text: `Traffic source: injects ${inflow.toFixed(0)} req/s from the active scenario.`,
        },
      ],
    };
  },
};
