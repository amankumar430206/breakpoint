import { z } from 'zod';
import { mmc, mmck } from '../queueing';
import { metricsFromQueue } from './util';
import { deriveConcurrency } from './apiServer';
import { bool, num, type ComponentModel } from './types';

/**
 * Background job worker — pulls from a queue and processes jobs. Same
 * resource-derived concurrency model as the API server (vCPU / RAM), but jobs
 * are usually heavier and the pool rarely sheds: instead it falls behind and the
 * upstream queue backs up. Set a large `queueLimit` (or turn shedding off) to
 * model that.
 */
export const workerModel: ComponentModel = {
  type: 'worker',
  label: 'Worker',
  category: 'compute',
  routing: 'replicate',
  handles: { in: true, out: true },
  defaultParams: {
    jobTimeMs: 150,
    vcpus: 2,
    ramGB: 4,
    parallelPerVcpu: 3,
    memPerReqMB: 96,
    replicas: 1,
    queueLimit: 2000,
    loadShedding: false,
    intrinsicErrorRate: 0.005,
  },
  paramSchema: z.object({
    jobTimeMs: z.number().positive().max(120000).default(150),
    vcpus: z.number().positive().max(192).default(2),
    ramGB: z.number().positive().max(4096).default(4),
    parallelPerVcpu: z.number().positive().max(256).default(3),
    memPerReqMB: z.number().positive().max(8192).default(96),
    replicas: z.number().int().positive().max(500).default(1),
    queueLimit: z.number().int().nonnegative().max(200000).default(2000),
    loadShedding: z.boolean().default(false),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.005),
  }),
  paramDocs: {
    jobTimeMs: 'Mean time to process one job (exponential).',
    vcpus: 'Virtual CPUs per worker instance.',
    ramGB: 'Memory per worker instance.',
    parallelPerVcpu: 'Jobs a vCPU overlaps (lower than a web tier — jobs are CPU-heavy).',
    memPerReqMB: 'Working-set memory per in-flight job.',
    replicas: 'Number of worker instances consuming the queue.',
    queueLimit: 'In-pool backlog before jobs error (only when load shedding is on).',
    loadShedding: 'Off (default): the pool never drops — it falls behind and the queue grows.',
    intrinsicErrorRate: 'Baseline job failure rate.',
  },
  scaleParam: { key: 'replicas', label: 'workers', min: 1, max: 256 },

  presetLegend: 'vCPU · RAM (GB)',
  presets: [
    { label: '2·4', hint: 'Medium — 2 vCPU / 4 GB (t3.medium)', patch: { vcpus: 2, ramGB: 4 } },
    { label: '2·8', hint: 'General large — 2 vCPU / 8 GB (m5.large)', patch: { vcpus: 2, ramGB: 8 } },
    { label: '4·8', hint: 'Compute — 4 vCPU / 8 GB (c6i.xlarge)', patch: { vcpus: 4, ramGB: 8 } },
    { label: '4·16', hint: 'General xlarge — 4 vCPU / 16 GB (m5.xlarge)', patch: { vcpus: 4, ramGB: 16 } },
    { label: '8·32', hint: 'General 2xlarge — 8 vCPU / 32 GB (m5.2xlarge)', patch: { vcpus: 8, ramGB: 32 } },
    { label: '16·64', hint: '4xlarge — 16 vCPU / 64 GB (m5.4xlarge)', patch: { vcpus: 16, ramGB: 64 } },
  ],

  outflowFraction: () => 1,

  simSpec: (params) => {
    const per = deriveConcurrency(params).concurrency;
    const c = per * Math.max(1, Math.round(num(params, 'replicas', 1)));
    return {
      servers: c,
      serviceRate: 1000 / num(params, 'jobTimeMs', 150),
      queueCap: bool(params, 'loadShedding', false)
        ? Math.max(0, Math.round(num(params, 'queueLimit', 2000)))
        : Infinity,
      fixedLatencySec: 0,
      errorRate: num(params, 'intrinsicErrorRate', 0.005),
      branchProb: 1,
    };
  },

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const sizing = deriveConcurrency(params);
    const mu = 1000 / num(params, 'jobTimeMs', 150);
    const replicas = Math.max(1, Math.round(num(params, 'replicas', 1)));
    const c = sizing.concurrency * replicas;
    const shed = bool(params, 'loadShedding', false);
    const K = c + Math.max(0, Math.round(num(params, 'queueLimit', 2000)));
    const qr = shed ? mmck(inflow, mu, c, K) : mmc(inflow, mu, c);
    const metrics = metricsFromQueue(qr, {
      offered: inflow,
      capacity: c * mu,
      servers: c,
      intrinsicErrorRate: num(params, 'intrinsicErrorRate', 0.005),
      downstreamErrorRate,
    });
    return {
      metrics,
      explain: [
        {
          metric: 'rho',
          text: `${replicas} worker(s) × ${sizing.concurrency} concurrent = ${c} slots at ${num(params, 'jobTimeMs', 150)} ms ⇒ ${(c * mu).toFixed(0)} jobs/s, ρ = ${qr.rho.toFixed(3)} (${sizing.bound}-bound).`,
          formula: 'ρ = λ / (concurrency · workers · μ)',
        },
        {
          metric: 'inQueue',
          text:
            qr.rho >= 1
              ? `Consumers can't keep up — the upstream queue grows ≈ ${metrics.backlogGrowth.toFixed(0)} jobs/s. Add workers.`
              : `Draining faster than jobs arrive — no lasting backlog.`,
          dominantTerm: qr.rho >= 1 ? 'consumer capacity' : undefined,
        },
      ],
    };
  },
};
