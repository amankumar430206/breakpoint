import { z } from 'zod';
import { mmc } from '../queueing';
import { metricsFromQueue } from './util';
import { idleMetrics, num, type ComponentModel } from './types';

/**
 * Batch / scheduled job — cron, an Airflow task, a nightly ETL, a rollup job.
 * It originates its own load on a timer: `recordsPerRun` records every
 * `intervalSec`. v1 is an **average-rate** model — it injects
 * `recordsPerRun / intervalSec` req/s into its downstream and reports a
 * duty-cycle utilisation. (A true periodic burst is a later addition; the
 * `explain` notes when the burst rate would matter.)
 *
 * `selfLoad` is analytical-only, so a batch job shows its steady load in the
 * analytical view but not in the live simulation.
 */
export const batchJobModel: ComponentModel = {
  type: 'batchJob',
  label: 'Batch / Scheduled Job',
  category: 'compute',
  routing: 'replicate',
  handles: { in: true, out: true },
  defaultParams: {
    intervalSec: 3600,
    recordsPerRun: 100000,
    recordServiceMs: 5,
    parallelism: 8,
    intrinsicErrorRate: 0.001,
  },
  paramSchema: z.object({
    intervalSec: z.number().positive().max(2592000).default(3600),
    recordsPerRun: z.number().int().positive().max(1e12).default(100000),
    recordServiceMs: z.number().positive().max(600000).default(5),
    parallelism: z.number().int().min(1).max(4096).default(8),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.001),
  }),
  paramDocs: {
    intervalSec: 'How often the job runs.',
    recordsPerRun: 'Records processed per run.',
    recordServiceMs: 'Processing time per record.',
    parallelism: 'Workers / tasks within a run.',
    intrinsicErrorRate: 'Baseline per-record error rate.',
  },
  scaleParam: { key: 'parallelism', label: 'parallelism', min: 1, max: 512 },

  presetLegend: 'run interval (seconds)',
  presets: [
    { label: '1 min', hint: 'Near-real-time micro-batch', patch: { intervalSec: 60 } },
    { label: '5 min', hint: 'Frequent rollup', patch: { intervalSec: 300 } },
    { label: 'hourly', hint: 'Standard ETL', patch: { intervalSec: 3600 } },
    { label: 'daily', hint: 'Nightly job', patch: { intervalSec: 86400 } },
  ],

  outflowFraction: () => 1,

  selfLoad: (params) =>
    num(params, 'recordsPerRun', 100000) / Math.max(0.001, num(params, 'intervalSec', 3600)),

  simSpec: (params) => ({
    servers: Math.max(1, Math.round(num(params, 'parallelism', 8))),
    serviceRate: 1000 / num(params, 'recordServiceMs', 5),
    queueCap: Infinity,
    fixedLatencySec: 0,
    errorRate: num(params, 'intrinsicErrorRate', 0.001),
    branchProb: 1,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const c = Math.max(1, Math.round(num(params, 'parallelism', 8)));
    if (inflow <= 0) return { metrics: idleMetrics(c), explain: [] };

    const recMs = num(params, 'recordServiceMs', 5);
    const mu = 1000 / recMs;
    const qr = mmc(inflow, mu, c);
    const metrics = metricsFromQueue(qr, {
      offered: inflow,
      capacity: c * mu,
      servers: c,
      intrinsicErrorRate: num(params, 'intrinsicErrorRate', 0.001),
      downstreamErrorRate,
    });

    const recordsPerRun = num(params, 'recordsPerRun', 100000);
    const intervalSec = num(params, 'intervalSec', 3600);
    const runWindowSec = (recordsPerRun * recMs) / 1000 / c;
    const burstRate = runWindowSec > 0 ? recordsPerRun / runWindowSec : inflow;
    return {
      metrics,
      explain: [
        {
          metric: 'arrivalRate',
          text: `${recordsPerRun.toLocaleString()} records every ${intervalSec}s ⇒ ~${inflow.toFixed(1)} records/s average into downstream. Duty-cycle ρ = ${qr.rho.toFixed(3)}.`,
          formula: 'avg rate = recordsPerRun / intervalSec',
        },
        {
          metric: 'arrivalRate',
          text: `Average-rate model. A real run does all ${recordsPerRun.toLocaleString()} in ~${runWindowSec.toFixed(0)}s at ~${burstRate.toFixed(0)} records/s — if that burst overloads a shared store, this steady-state view understates it. Spread the job out or throttle it.`,
          dominantTerm: 'burst vs average',
        },
      ],
    };
  },
};
