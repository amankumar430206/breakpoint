import { z } from 'zod';
import { erlangB, mmck } from '../queueing';
import { metricsFromQueue } from './util';
import { idleMetrics, num, type ComponentModel } from './types';

/**
 * Serverless function — AWS Lambda / Cloud Functions / Azure Functions. The
 * platform runs one execution environment per concurrent request and spins new
 * ones up on demand, so there is no queue: once `maxConcurrency` environments
 * are busy, further requests are **throttled** (429). A fraction
 * `coldStartRate` of invocations pay a `coldStartMs` init penalty on top of
 * `execTimeMs`.
 *
 * Modelled as an M/M/c/c loss system (c = maxConcurrency, no waiting room) with
 * a blended service time `execTimeMs + coldStartRate · coldStartMs`.
 */
export const serverlessFnModel: ComponentModel = {
  type: 'serverlessFn',
  label: 'Serverless Function',
  category: 'compute',
  routing: 'replicate',
  handles: { in: true, out: true },
  defaultParams: {
    execTimeMs: 60,
    coldStartMs: 400,
    coldStartRate: 0.05,
    maxConcurrency: 1000,
    intrinsicErrorRate: 0.001,
  },
  paramSchema: z.object({
    execTimeMs: z.number().positive().max(900000).default(60),
    coldStartMs: z.number().nonnegative().max(60000).default(400),
    coldStartRate: z.number().min(0).max(1).default(0.05),
    maxConcurrency: z.number().int().positive().max(100000).default(1000),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.001),
  }),
  paramDocs: {
    execTimeMs: 'Warm execution time — the function body without init.',
    coldStartMs: 'Extra init time when a fresh environment has to start.',
    coldStartRate: 'Fraction of invocations that hit a cold start (lower with more steady traffic / provisioned concurrency).',
    maxConcurrency: 'Concurrent executions allowed before requests are throttled (429).',
    intrinsicErrorRate: 'Baseline function error rate.',
  },

  scaleParam: { key: 'maxConcurrency', label: 'max concurrency', min: 100, max: 100000, step: 100 },

  presetLegend: 'max concurrent executions',
  presets: [
    { label: '100', hint: 'Reserved-concurrency slice', patch: { maxConcurrency: 100 } },
    { label: '1k', hint: 'AWS account default', patch: { maxConcurrency: 1000 } },
    { label: '5k', hint: 'Raised limit', patch: { maxConcurrency: 5000 } },
    { label: '10k', hint: 'Large raised limit', patch: { maxConcurrency: 10000 } },
  ],

  outflowFraction: (params, ctx) => {
    const inflow = ctx?.inflow ?? 0;
    if (inflow <= 0) return 1;
    const c = Math.max(1, Math.round(num(params, 'maxConcurrency', 1000)));
    const mu = 1000 / blendedMs(params);
    return 1 - erlangB(c, inflow / mu); // 1 − throttle probability
  },

  simSpec: (params) => ({
    servers: Math.max(1, Math.round(num(params, 'maxConcurrency', 1000))),
    serviceRate: 1000 / Math.max(0.001, num(params, 'execTimeMs', 60)), // warm rate
    queueCap: 0, // no waiting room — excess is throttled
    fixedLatencySec: 0,
    errorRate: num(params, 'intrinsicErrorRate', 0.001),
    branchProb: 1,
    coldStart: {
      rate: num(params, 'coldStartRate', 0.05),
      extraSec: num(params, 'coldStartMs', 400) / 1000,
    },
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const c = Math.max(1, Math.round(num(params, 'maxConcurrency', 1000)));
    if (inflow <= 0) return { metrics: idleMetrics(c), explain: [] };

    const svcMs = blendedMs(params);
    const mu = 1000 / svcMs;
    const intrinsic = num(params, 'intrinsicErrorRate', 0.001);
    const cold = num(params, 'coldStartRate', 0.05);

    // M/M/c/c: no queue, K = c ⇒ arrivals over the ceiling are throttled.
    const qr = mmck(inflow, mu, c, c);
    const metrics = metricsFromQueue(qr, {
      offered: inflow,
      capacity: c * mu,
      servers: c,
      intrinsicErrorRate: intrinsic,
      downstreamErrorRate,
    });

    const needed = inflow * (svcMs / 1000); // Little's law: mean concurrent execs
    return {
      metrics,
      explain: [
        {
          metric: 'latency.mean',
          text: `Cold starts on ~${(cold * 100).toFixed(0)}% of invocations add ${num(params, 'coldStartMs', 400)} ms ⇒ effective exec ${svcMs.toFixed(0)} ms (warm ${num(params, 'execTimeMs', 60)} ms).`,
          formula: 'svc = execTimeMs + coldStartRate · coldStartMs',
          dominantTerm: cold * num(params, 'coldStartMs', 400) > num(params, 'execTimeMs', 60) ? 'cold-start tax' : 'execution time',
        },
        {
          metric: 'dropRate',
          text:
            qr.pBlock > 0.001
              ? `${inflow.toFixed(0)} req/s × ${svcMs.toFixed(0)} ms needs ~${needed.toFixed(0)} concurrent executions, over the ${c} ceiling — ${(qr.pBlock * 100).toFixed(0)}% throttled (429). Raise the concurrency limit or cut exec time.`
              : `~${needed.toFixed(0)} of ${c} concurrent executions in use — headroom before throttling.`,
          formula: 'M/M/c/c, c = maxConcurrency',
        },
      ],
    };
  },
};

function blendedMs(params: Record<string, unknown>): number {
  return (
    Math.max(0.001, num(params, 'execTimeMs', 60)) +
    num(params, 'coldStartRate', 0.05) * num(params, 'coldStartMs', 400)
  );
}
