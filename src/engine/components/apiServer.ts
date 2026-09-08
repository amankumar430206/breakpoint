import { z } from 'zod';
import { mmc, mmck } from '../queueing';
import { metricsFromQueue } from './util';
import { bool, num, type ComponentModel, type SolveNodeCtx } from './types';

/**
 * Stateless application server, sized the way a cloud provider sells one: pick
 * vCPUs, RAM and disk. Per-replica request concurrency is *derived*:
 *
 *   cpuSlots = vcpus · parallelPerVcpu           (in-flight requests a core juggles)
 *   memSlots = floor(ramGB · 1024 / memPerReqMB) (working set per in-flight request)
 *   concurrency = min(cpuSlots, memSlots)        (whichever runs out first)
 *
 * so you can watch a box go from CPU-bound to RAM-bound as you change its shape.
 * The pool is one M/M/c/K queue with c = concurrency · replicas; requests past
 * c + queueLimit are shed (503) unless load shedding is off.
 */

export interface ServerSizing {
  concurrency: number;
  cpuSlots: number;
  memSlots: number;
  bound: 'cpu' | 'ram';
}

export function deriveConcurrency(params: Record<string, unknown>): ServerSizing {
  // Explicit `concurrency` (legacy / power users) wins over the resource model.
  const explicit = params.concurrency;
  if (typeof explicit === 'number' && explicit > 0) {
    const c = Math.max(1, Math.round(explicit));
    return { concurrency: c, cpuSlots: c, memSlots: Infinity, bound: 'cpu' };
  }

  const vcpus = Math.max(0.25, num(params, 'vcpus', 2));
  const perVcpu = Math.max(1, num(params, 'parallelPerVcpu', 8));
  // A co-located database's buffer pool is carved out of the box's RAM, so it
  // leaves fewer slots for in-flight requests (this is how a single box tips
  // from CPU-bound to RAM-bound once you put the DB on it).
  const dbBufferGB = bool(params, 'colocatedDb', false) ? num(params, 'dbBufferGB', 1) : 0;
  const ramGB = Math.max(0.125, num(params, 'ramGB', 4) - dbBufferGB);
  const memPerReqMB = Math.max(1, num(params, 'memPerReqMB', 40));

  const cpuSlots = Math.max(1, Math.round(vcpus * perVcpu));
  const memSlots = Math.max(1, Math.floor((ramGB * 1024) / memPerReqMB));
  return {
    concurrency: Math.min(cpuSlots, memSlots),
    cpuSlots,
    memSlots,
    bound: memSlots < cpuSlots ? 'ram' : 'cpu',
  };
}

/** Mean CPU time per request, including any co-located DB query time. */
export function effectiveServiceMs(params: Record<string, unknown>): number {
  const base = num(params, 'serviceTimeMs', 40);
  if (!bool(params, 'colocatedDb', false)) return base;
  return base + num(params, 'queriesPerRequest', 3) * num(params, 'dbQueryMs', 8);
}

export const apiServerModel: ComponentModel = {
  type: 'apiServer',
  label: 'API Server',
  category: 'compute',
  routing: 'replicate',
  handles: { in: true, out: true },
  defaultParams: {
    vcpus: 2,
    ramGB: 4,
    storageGB: 20,
    serviceTimeMs: 40,
    parallelPerVcpu: 8,
    memPerReqMB: 40,
    replicas: 1,
    queueLimit: 200,
    loadShedding: true,
    intrinsicErrorRate: 0.001,
    autoscale: false,
    targetUtil: 0.7,
    maxReplicas: 12,
    colocatedDb: false,
    dbQueryMs: 6,
    queriesPerRequest: 3,
    dbBufferGB: 1,
  },
  paramSchema: z.object({
    vcpus: z.number().positive().max(192).default(2),
    ramGB: z.number().positive().max(4096).default(4),
    storageGB: z.number().nonnegative().max(65536).default(20),
    serviceTimeMs: z.number().positive().max(30000).default(40),
    parallelPerVcpu: z.number().positive().max(256).default(8),
    memPerReqMB: z.number().positive().max(4096).default(40),
    concurrency: z.number().int().positive().optional(),
    replicas: z.number().int().positive().max(500).default(1),
    queueLimit: z.number().int().nonnegative().max(50000).default(200),
    loadShedding: z.boolean().default(true),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.001),
    autoscale: z.boolean().default(false),
    targetUtil: z.number().gt(0).lt(1).default(0.7),
    maxReplicas: z.number().int().positive().max(500).default(12),
    colocatedDb: z.boolean().default(false),
    dbQueryMs: z.number().positive().max(2000).default(6),
    queriesPerRequest: z.number().nonnegative().max(50).default(3),
    dbBufferGB: z.number().nonnegative().max(512).default(1),
  }),
  paramDocs: {
    vcpus: 'Virtual CPUs per instance (e.g. t3.small ≈ 2, c6i.xlarge ≈ 4).',
    ramGB: 'Memory per instance.',
    storageGB: 'Disk per instance (not a throughput constraint for a stateless tier).',
    serviceTimeMs: 'Mean CPU time to handle one request (exponential).',
    parallelPerVcpu: 'In-flight requests one vCPU overlaps (higher = more IO-bound).',
    memPerReqMB: 'Working-set memory held per in-flight request.',
    replicas: 'Number of identical instances behind the load balancer.',
    queueLimit: 'Accept queue depth per pool before requests are shed (503).',
    loadShedding: 'On: full pool → 503 fast (bounded latency). Off: unbounded queue → latency blows up past capacity.',
    intrinsicErrorRate: 'Baseline 5xx rate independent of load.',
    autoscale: 'Add replicas automatically to hold utilization at the target.',
    targetUtil: 'Utilization the autoscaler aims for.',
    maxReplicas: 'Upper bound on autoscaled replicas.',
    colocatedDb: 'Run the database on the same box (no separate DB node). Its query time is added to each request and its buffer pool eats into RAM.',
    dbQueryMs: 'Mean time for one local DB query (shares this box’s CPU).',
    queriesPerRequest: 'DB queries each request makes against the local database.',
    dbBufferGB: 'RAM reserved for the local DB buffer pool — carved out of this box’s memory.',
  },
  scaleParam: { key: 'replicas', label: 'replicas', min: 1, max: 256 },

  // Standard cloud instance shapes (vCPU · GB). Names are AWS; the rough
  // equivalents on GCP / Azure / DigitalOcean have the same shape.
  presetLegend: 'vCPU · RAM (GB)',
  presets: [
    { label: '1·2', hint: 'Small — 1 vCPU / 2 GB (t3.small · e2-small · s-1vcpu-2gb)', patch: { vcpus: 1, ramGB: 2, storageGB: 20 } },
    { label: '2·4', hint: 'Medium — 2 vCPU / 4 GB (t3.medium · e2-medium)', patch: { vcpus: 2, ramGB: 4, storageGB: 40 } },
    { label: '2·8', hint: 'General large — 2 vCPU / 8 GB (m5.large · n2-standard-2)', patch: { vcpus: 2, ramGB: 8, storageGB: 40 } },
    { label: '4·8', hint: 'Compute — 4 vCPU / 8 GB (c6i.xlarge · c2-standard-4)', patch: { vcpus: 4, ramGB: 8, storageGB: 60 } },
    { label: '4·16', hint: 'General xlarge — 4 vCPU / 16 GB (m5.xlarge · n2-standard-4)', patch: { vcpus: 4, ramGB: 16, storageGB: 80 } },
    { label: '8·32', hint: 'General 2xlarge — 8 vCPU / 32 GB (m5.2xlarge)', patch: { vcpus: 8, ramGB: 32, storageGB: 160 } },
    { label: '16·64', hint: '4xlarge — 16 vCPU / 64 GB (m5.4xlarge)', patch: { vcpus: 16, ramGB: 64, storageGB: 320 } },
  ],

  fieldVisible: (key, params) =>
    key === 'dbQueryMs' || key === 'queriesPerRequest' || key === 'dbBufferGB'
      ? bool(params, 'colocatedDb', false)
      : true,

  outflowFraction: () => 1,

  simSpec: (params) => {
    const per = deriveConcurrency(params).concurrency;
    const c = per * Math.max(1, Math.round(num(params, 'replicas', 1)));
    return {
      servers: c,
      serviceRate: 1000 / effectiveServiceMs(params),
      queueCap: bool(params, 'loadShedding', true)
        ? Math.max(0, Math.round(num(params, 'queueLimit', 200)))
        : Infinity,
      fixedLatencySec: 0,
      errorRate: num(params, 'intrinsicErrorRate', 0.001),
      branchProb: 1,
    };
  },

  solve: (ctx: SolveNodeCtx) => {
    const { params, inflow, downstreamErrorRate } = ctx;
    const baseServiceMs = num(params, 'serviceTimeMs', 40);
    const serviceMs = effectiveServiceMs(params);
    const colocated = bool(params, 'colocatedDb', false);
    const sizing = deriveConcurrency(params);
    const concurrency = sizing.concurrency;
    const mu = 1000 / serviceMs;
    const intrinsic = num(params, 'intrinsicErrorRate', 0.001);
    const queueLimit = Math.max(0, Math.round(num(params, 'queueLimit', 200)));

    let replicas = Math.max(1, Math.round(num(params, 'replicas', 1)));
    let autoscaled = false;
    if (bool(params, 'autoscale', false)) {
      const target = num(params, 'targetUtil', 0.7);
      const maxR = Math.max(1, Math.round(num(params, 'maxReplicas', 12)));
      const needed = Math.ceil(inflow / (mu * concurrency * target));
      const picked = Math.min(maxR, Math.max(1, needed));
      autoscaled = picked !== replicas;
      replicas = picked;
    }

    const c = concurrency * replicas;
    const K = c + queueLimit;
    const shed = bool(params, 'loadShedding', true);
    const qr = shed ? mmck(inflow, mu, c, K) : mmc(inflow, mu, c);
    const metrics = metricsFromQueue(qr, {
      offered: inflow,
      capacity: c * mu,
      servers: c,
      intrinsicErrorRate: intrinsic,
      downstreamErrorRate,
    });

    const explain = [
      ...(colocated
        ? [
            {
              metric: 'latency.mean',
              text: `Database runs on this box: +${num(params, 'queriesPerRequest', 3)} queries × ${num(params, 'dbQueryMs', 6)} ms = +${(serviceMs - baseServiceMs).toFixed(0)} ms of CPU per request, and ${num(params, 'dbBufferGB', 1)} GB of RAM held for its buffer pool. App and DB share one resource pool.`,
              formula: 'serviceMs = handler + queriesPerRequest · dbQueryMs',
              dominantTerm: 'shared box',
            },
          ]
        : []),
      {
        metric: 'servers',
        text: `${num(params, 'vcpus', 2)} vCPU × ${num(params, 'parallelPerVcpu', 8)} = ${sizing.cpuSlots} CPU slots; ${(num(params, 'ramGB', 4) - (colocated ? num(params, 'dbBufferGB', 1) : 0)).toFixed(1)} GB ÷ ${num(params, 'memPerReqMB', 40)} MB = ${sizing.memSlots} RAM slots ⇒ ${concurrency} concurrent/replica (${sizing.bound}-bound).`,
        formula: 'concurrency = min(vcpus·parallelPerVcpu, ramGB·1024 / memPerReqMB)',
        dominantTerm: sizing.bound === 'ram' ? 'RAM per request' : 'vCPU count',
      },
      {
        metric: 'rho',
        text: `${replicas} replica(s) × ${concurrency} = ${c} slots at ${serviceMs} ms ⇒ capacity ${(c * mu).toFixed(0)} req/s, ρ = ${qr.rho.toFixed(3)}.${autoscaled ? ' (autoscaled)' : ''}`,
        formula: 'ρ = λ / (concurrency · replicas · μ)',
      },
      {
        metric: 'latency.p99',
        text:
          qr.rho >= 1
            ? `Offered load exceeds capacity — the accept queue never drains; p99 is unbounded and backlog grows ≈ ${metrics.backlogGrowth.toFixed(0)} req/s.`
            : `Queueing inflates latency by the M/M/c factor 1/(1−ρ) = ${(1 / (1 - qr.rho)).toFixed(2)}×; service floor is ${serviceMs} ms.`,
        dominantTerm: qr.rho > 0.8 ? '1/(1−ρ) queueing term' : 'service time',
      },
      {
        metric: 'dropRate',
        text:
          qr.pBlock > 1e-6
            ? `${(qr.pBlock * 100).toFixed(1)}% of requests hit a full pool (c+queue = ${K}) and are shed.`
            : !shed && metrics.overloaded
              ? `Load shedding is off — the queue is unbounded, so nothing is dropped but latency has no ceiling.`
              : `Accept queue (depth ${queueLimit}) has headroom — no shedding.`,
      },
    ];

    return { metrics, explain };
  },
};
