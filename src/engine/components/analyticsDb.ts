import { z } from 'zod';
import { mmck } from '../queueing';
import { metricsFromQueue } from './util';
import { bool, idleMetrics, num, type ComponentModel } from './types';

/**
 * Data warehouse / OLAP store — Snowflake, BigQuery, Redshift. Columnar big
 * scans measured in **seconds**, and the ceiling is a fixed number of
 * **concurrency slots** (a "warehouse" / cluster size), not a connection pool ×
 * service-rate product. A `resultCacheHitRatio` fraction of repeated queries
 * come straight back from the result cache. When every slot is busy, queries
 * either queue or (with `queueOnFull` off) fail fast.
 *
 * Off the request path — fed by CDC / a stream processor / a BI tool.
 */
const HIT_SEC = 0.01;

export const analyticsDbModel: ComponentModel = {
  type: 'analyticsDb',
  label: 'Data Warehouse',
  category: 'data',
  routing: 'sink',
  handles: { in: true, out: false },
  defaultParams: {
    scanTimeSec: 3,
    concurrencySlots: 8,
    resultCacheHitRatio: 0.3,
    queueOnFull: true,
    queueLimit: 100,
    intrinsicErrorRate: 0.001,
  },
  paramSchema: z.object({
    scanTimeSec: z.number().positive().max(600).default(3),
    concurrencySlots: z.number().int().positive().max(1000).default(8),
    resultCacheHitRatio: z.number().min(0).max(1).default(0.3),
    queueOnFull: z.boolean().default(true),
    queueLimit: z.number().int().nonnegative().max(100000).default(100),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.001),
  }),
  paramDocs: {
    scanTimeSec: 'Mean columnar scan time for one query (seconds).',
    concurrencySlots: 'Concurrent queries the warehouse runs — the hard ceiling.',
    resultCacheHitRatio: 'Repeated queries served instantly from the result cache.',
    queueOnFull: 'On: extra queries wait for a slot. Off: they fail fast.',
    queueLimit: 'Queries allowed to wait for a slot (when queueOnFull).',
    intrinsicErrorRate: 'Baseline query error rate.',
  },
  scaleParam: { key: 'concurrencySlots', label: 'slots', min: 1, max: 512 },

  presetLegend: 'concurrent query slots',
  presets: [
    { label: '4', hint: 'X-Small warehouse', patch: { concurrencySlots: 4 } },
    { label: '8', hint: 'Small', patch: { concurrencySlots: 8 } },
    { label: '16', hint: 'Medium', patch: { concurrencySlots: 16 } },
    { label: '32', hint: 'Large', patch: { concurrencySlots: 32 } },
    { label: '64', hint: 'X-Large / multi-cluster', patch: { concurrencySlots: 64 } },
  ],

  outflowFraction: () => 0,

  simSpec: (params) => ({
    servers: Math.max(1, Math.round(num(params, 'concurrencySlots', 8))),
    serviceRate: 1 / svcSec(params),
    queueCap: bool(params, 'queueOnFull', true) ? Math.max(0, Math.round(num(params, 'queueLimit', 100))) : 0,
    fixedLatencySec: 0,
    errorRate: num(params, 'intrinsicErrorRate', 0.001),
    branchProb: 1,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const c = Math.max(1, Math.round(num(params, 'concurrencySlots', 8)));
    if (inflow <= 0) return { metrics: idleMetrics(c), explain: [] };

    const scan = num(params, 'scanTimeSec', 3);
    const hit = num(params, 'resultCacheHitRatio', 0.3);
    const svc = svcSec(params);
    const mu = 1 / svc;
    const queued = bool(params, 'queueOnFull', true);
    const K = c + (queued ? Math.max(0, Math.round(num(params, 'queueLimit', 100))) : 0);

    const qr = mmck(inflow, mu, c, K);
    const metrics = metricsFromQueue(qr, {
      offered: inflow,
      capacity: c * mu,
      servers: c,
      intrinsicErrorRate: num(params, 'intrinsicErrorRate', 0.001),
      downstreamErrorRate,
    });

    return {
      metrics,
      explain: [
        {
          metric: 'rho',
          text: `${c} slots × one ${scan}s scan; ${(hit * 100).toFixed(0)}% from the result cache ⇒ ~${svc.toFixed(1)}s effective per query, capacity ≈ ${(c * mu).toFixed(1)} queries/s. ρ = ${qr.rho.toFixed(3)}.`,
          formula: 'capacity = concurrencySlots / ((1−cacheHit)·scanTimeSec + cacheHit·10ms)',
          dominantTerm: qr.rho > 0.85 ? 'slot contention' : 'scan time',
        },
        {
          metric: 'dropRate',
          text: queued
            ? qr.pBlock > 0.001
              ? `Slots + ${num(params, 'queueLimit', 100)}-deep wait queue full — ${(qr.pBlock * 100).toFixed(0)}% of queries error. Resize the warehouse up.`
              : `Queries wait for a free slot (up to ${num(params, 'queueLimit', 100)}); latency is in seconds, not ms.`
            : `queueOnFull off — anything over ${c} concurrent queries fails fast (${(qr.pBlock * 100).toFixed(0)}% now).`,
        },
      ],
    };
  },
};

function svcSec(params: Record<string, unknown>): number {
  const scan = Math.max(0.001, num(params, 'scanTimeSec', 3));
  const hit = num(params, 'resultCacheHitRatio', 0.3);
  return (1 - hit) * scan + hit * HIT_SEC;
}
