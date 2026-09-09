import { z } from 'zod';
import { mmc, mmck } from '../queueing';
import { addLatency, blendMembers, metricsFromQueue } from './util';
import type { ExplainNote, NodeMetrics } from '../types';
import { bool, idleMetrics, num, str, type ComponentModel } from './types';

/**
 * Search cluster — Elasticsearch / OpenSearch. An inverted index split into
 * `shards`, each with `replicas` copies. A **query scatter-gathers to every
 * shard** and waits for the slowest one, so query tail latency tracks the
 * busiest shard — more shards lower per-shard load but don't shorten a single
 * query. Indexing routes a document to one shard's primary and fans out to its
 * replicas. A freshly-indexed document isn't searchable until the next refresh
 * (`refreshIntervalSec`).
 */

function zipf(n: number): number[] {
  let h = 0;
  for (let k = 1; k <= n; k++) h += 1 / k;
  return Array.from({ length: n }, (_, i) => 1 / (i + 1) / h); // shard 0 hottest
}

export const searchIndexModel: ComponentModel = {
  type: 'searchIndex',
  label: 'Search Cluster',
  category: 'data',
  routing: 'sink',
  handles: { in: true, out: false },
  defaultParams: {
    queryTimeMs: 60,
    coordinatorMs: 3,
    indexTimeMs: 6,
    shards: 5,
    replicas: 1,
    readRatio: 0.85,
    refreshIntervalSec: 1,
    poolSize: 32,
    queueLimit: 200,
    loadShedding: true,
    keyDistribution: 'uniform',
    intrinsicErrorRate: 0.0005,
  },
  paramSchema: z.object({
    queryTimeMs: z.number().positive().max(600000).default(60),
    coordinatorMs: z.number().nonnegative().max(10000).default(3),
    indexTimeMs: z.number().positive().max(60000).default(6),
    shards: z.number().int().min(1).max(1024).default(5),
    replicas: z.number().int().min(0).max(32).default(1),
    readRatio: z.number().min(0).max(1).default(0.85),
    refreshIntervalSec: z.number().positive().max(600).default(1),
    poolSize: z.number().int().positive().max(10000).default(32),
    queueLimit: z.number().int().nonnegative().max(200000).default(200),
    loadShedding: z.boolean().default(true),
    keyDistribution: z.enum(['uniform', 'zipfian']).default('uniform'),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.0005),
  }),
  paramDocs: {
    queryTimeMs: 'Full-index search time on one node — split across shards (each shard searches 1/shards of the data).',
    coordinatorMs: 'Fixed coordination + merge cost added to every query.',
    indexTimeMs: 'Time to index one document on a shard copy.',
    shards: 'Primary shards the index is split into — more shards = smaller + faster per shard, but a bigger scatter-gather.',
    replicas: 'Replica copies per shard — spread query load, add index cost.',
    readRatio: 'Fraction of operations that are searches (vs indexing).',
    refreshIntervalSec: 'How long until a newly-indexed doc becomes searchable.',
    poolSize: 'Concurrent request slots per shard copy.',
    queueLimit: 'Requests that may wait per shard copy before erroring.',
    loadShedding: 'On: a full shard errors fast. Off: unbounded wait.',
    keyDistribution: 'uniform = balanced shards; zipfian = one hot shard.',
    intrinsicErrorRate: 'Baseline error rate.',
  },
  scaleParam: { key: 'shards', label: 'shards', min: 1, max: 512 },

  presetLegend: 'query slots per shard copy',
  presets: [
    { label: '16', hint: 'Small data node', patch: { poolSize: 16 } },
    { label: '32', hint: 'Standard data node', patch: { poolSize: 32 } },
    { label: '64', hint: 'Large data node', patch: { poolSize: 64 } },
    { label: '128', hint: 'Search-optimised node', patch: { poolSize: 128 } },
  ],

  outflowFraction: () => 0,

  simSpec: (params) => {
    const n = Math.max(1, Math.round(num(params, 'shards', 5)));
    const r = Math.max(0, Math.round(num(params, 'replicas', 1)));
    const rr = num(params, 'readRatio', 0.85);
    const pool = Math.max(1, Math.round(num(params, 'poolSize', 32)));
    const queueLimit = Math.max(0, Math.round(num(params, 'queueLimit', 200)));
    const copies = n * (1 + r);
    const muQuery = 1000 / (num(params, 'queryTimeMs', 60) / n); // per-shard: 1/n of the data
    const muIndex = 1000 / num(params, 'indexTimeMs', 6);
    // per-copy read/write split (see solve) → one blended rate for the DES station
    const copyRead = rr; // relative
    const copyWrite = (1 - rr) * (1 + r) / n;
    const denom = copyRead + copyWrite || 1;
    const muBlend = 1 / ((copyRead / denom) / muQuery + (copyWrite / denom) / muIndex);
    return {
      servers: pool * copies,
      serviceRate: muBlend,
      queueCap: bool(params, 'loadShedding', true) ? queueLimit * copies : Infinity,
      fixedLatencySec:
        num(params, 'coordinatorMs', 3) / 1000 +
        (num(params, 'refreshIntervalSec', 1) / 2) * (1 - rr),
      errorRate: num(params, 'intrinsicErrorRate', 0.0005),
      branchProb: 0,
    };
  },

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const pool = Math.max(1, Math.round(num(params, 'poolSize', 32)));
    if (inflow <= 0) return { metrics: idleMetrics(pool), explain: [] };

    const n = Math.max(1, Math.round(num(params, 'shards', 5)));
    const r = Math.max(0, Math.round(num(params, 'replicas', 1)));
    const rr = num(params, 'readRatio', 0.85);
    const shed = bool(params, 'loadShedding', true);
    const queueLimit = Math.max(0, Math.round(num(params, 'queueLimit', 200)));
    const K = pool + queueLimit;
    const intrinsic = num(params, 'intrinsicErrorRate', 0.0005);
    const queryMs = num(params, 'queryTimeMs', 60);
    const muIndex = 1000 / num(params, 'indexTimeMs', 6);

    const reads = inflow * rr; // searches
    const writes = inflow - reads; // index ops
    const dist = str(params, 'keyDistribution', 'uniform');
    const weights = dist === 'zipfian' ? zipf(n) : Array.from({ length: n }, () => 1 / n);

    // Per shard-copy load: every search hits every shard (one of its 1+r copies);
    // indexing routes to one shard by key, then to all 1+r copies of it. A shard
    // holding `weight` of the data spends `queryMs·weight` searching it, so a
    // skewed (zipfian) key makes the hot shard both busier and slower per query.
    const queryPerCopy = reads / (1 + r);
    const parts = weights.map((w, k) => {
      const muQuery = 1000 / (queryMs * w);
      const indexPerCopy = writes * w; // this shard's share of index load, per copy
      const lam = queryPerCopy + indexPerCopy;
      const rf = lam > 0 ? queryPerCopy / lam : 1;
      const mu = 1 / (rf / muQuery + (1 - rf) / muIndex);
      const m = metricsFromQueue(shed ? mmck(lam, mu, pool, K) : mmc(lam, mu, pool), {
        offered: lam,
        capacity: pool * mu,
        servers: pool,
        intrinsicErrorRate: intrinsic,
        downstreamErrorRate,
      });
      return {
        label: `shard ${k}`,
        role: 'shard' as const,
        offered: lam,
        m,
        hot: dist === 'zipfian' && k === 0 && n > 1,
      };
    });

    const agg = blendMembers(parts);
    // Scatter-gather: a query is only as fast as the slowest shard — take the
    // worst shard's tail for the whole query.
    const worst = parts.reduce((mx, p) => (p.m.latency.p99 > mx.m.latency.p99 ? p : mx), parts[0]);
    agg.latency = {
      mean: Math.max(agg.latency.mean, worst.m.latency.mean),
      p50: Math.max(agg.latency.p50, worst.m.latency.p50),
      p95: worst.m.latency.p95,
      p99: worst.m.latency.p99,
    };
    const refreshSec = num(params, 'refreshIntervalSec', 1);
    const withRefresh = addLatency(
      agg,
      num(params, 'coordinatorMs', 3) / 1000 + (refreshSec / 2) * (1 - rr),
    );

    const explain: ExplainNote[] = [
      {
        metric: 'latency.p99',
        text: `Every search scatter-gathers to all ${n} shard(s) and waits for the slowest — query p99 tracks the busiest shard (${worst.label}, ρ ${worst.m.rho.toFixed(2)}), not the average. More shards lower each shard's load but don't shorten one query.`,
        formula: 'query latency = max over shards',
      },
      {
        metric: 'latency.mean',
        text:
          rr < 1
            ? `A freshly-indexed doc is searchable after ~${refreshSec}s (refresh); with ${((1 - rr) * 100).toFixed(0)}% indexing that adds ~${((refreshSec / 2) * (1 - rr) * 1000).toFixed(0)} ms to the read-your-writes path.`
            : `Pure search workload — refresh lag doesn't bite.`,
      },
    ];
    const hot = parts.find((p) => p.hot);
    if (hot) {
      explain.push({
        metric: 'rho',
        text: `${hot.label} is hot (zipfian keys) at ρ ${hot.m.rho.toFixed(2)} — rebalance the routing key or add shards.`,
        dominantTerm: 'shard skew',
      });
    }
    if (r === 0 && rr > 0.6) {
      explain.push({
        metric: 'rho',
        text: `No replicas — a lost shard loses those queries, and reads can't spread. Add a replica.`,
      });
    }

    return { metrics: withRefresh as NodeMetrics, explain };
  },
};
