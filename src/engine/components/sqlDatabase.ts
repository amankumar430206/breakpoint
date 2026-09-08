import { z } from 'zod';
import { mmc, mmck } from '../queueing';
import { blendMembers, metricsFromQueue } from './util';
import type { ExplainNote, MemberMetrics, NodeMetrics } from '../types';
import { bool, idleMetrics, num, str, type ComponentModel } from './types';

/**
 * Relational database with a selectable replication topology:
 *
 *  - single           one primary serves every read and write
 *  - primary-replica  writes → primary, reads spread across N async read replicas
 *                     (master–slave); replicas may serve slightly stale data
 *  - multi-primary     N primaries all accept reads AND writes; every write is
 *                     certified across the other N−1 nodes, so per-node write
 *                     capacity *drops* as you add primaries
 *  - sharded          N independent shards partition the keyspace; capacity
 *                     scales ~linearly, but skewed keys create a hot shard and
 *                     cross-shard queries fan out to every shard
 *
 * Each topology reports a per-member breakdown (`metrics.members`) so the node
 * can draw one sub-card per primary / replica / shard.
 */

const K_OF = (pool: number, queueLimit: number) => pool + queueLimit;

function zipfWeights(n: number): number[] {
  let h = 0;
  for (let k = 1; k <= n; k++) h += 1 / k;
  return Array.from({ length: n }, (_, i) => 1 / (i + 1) / h); // shard 0 hottest
}

export const sqlDatabaseModel: ComponentModel = {
  type: 'sqlDatabase',
  label: 'SQL Database',
  category: 'data',
  routing: 'sink',
  handles: { in: true, out: false },
  defaultParams: {
    architecture: 'primary-replica',
    queryTimeMs: 8,
    poolSize: 20,
    queueLimit: 100,
    loadShedding: true,
    readRatio: 0.8,
    intrinsicErrorRate: 0.0005,
    readReplicas: 0,
    primaries: 3,
    shards: 4,
    replicationLagMs: 50,
    writeCoordinationPct: 15,
    crossShardPct: 5,
    keyDistribution: 'uniform',
  },
  paramSchema: z.object({
    architecture: z
      .enum(['single', 'primary-replica', 'multi-primary', 'sharded'])
      .default('primary-replica'),
    queryTimeMs: z.number().positive().max(60000).default(8),
    poolSize: z.number().int().positive().default(20),
    queueLimit: z.number().int().nonnegative().default(100),
    loadShedding: z.boolean().default(true),
    readRatio: z.number().min(0).max(1).default(0.8),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.0005),
    readReplicas: z.number().int().nonnegative().max(24).default(0),
    primaries: z.number().int().min(1).max(16).default(3),
    shards: z.number().int().min(1).max(32).default(4),
    replicationLagMs: z.number().nonnegative().max(60000).default(50),
    writeCoordinationPct: z.number().min(0).max(200).default(15),
    crossShardPct: z.number().min(0).max(100).default(5),
    keyDistribution: z.enum(['uniform', 'zipfian']).default('uniform'),
  }),
  paramDocs: {
    architecture: 'Replication topology — changes which sub-options apply.',
    queryTimeMs: 'Mean query execution time (exponential).',
    poolSize: 'Connections per instance — the concurrency limit.',
    queueLimit: 'Requests that may wait for a connection before erroring.',
    loadShedding: 'On: pool full → query errors fast. Off: unbounded wait.',
    readRatio: 'Fraction of queries that are reads.',
    intrinsicErrorRate: 'Baseline query error rate.',
    readReplicas: 'Async read replicas (primary-replica). Reads spread across them.',
    primaries: 'Primary nodes that all accept reads + writes (multi-primary).',
    shards: 'Independent shards partitioning the keyspace (sharded).',
    replicationLagMs: 'How far replicas trail the primary — reads there can be stale.',
    writeCoordinationPct: 'Extra write cost per additional primary (cross-node certification).',
    crossShardPct: 'Share of queries that fan out to every shard (scatter-gather).',
    keyDistribution: 'uniform = even shards; zipfian = one hot shard.',
  },
  scaleParam: (params) => {
    switch (str(params, 'architecture', 'primary-replica')) {
      case 'primary-replica':
        return { key: 'readReplicas', label: 'read replicas', min: 0, max: 24 };
      case 'multi-primary':
        return { key: 'primaries', label: 'primaries', min: 1, max: 16 };
      case 'sharded':
        return { key: 'shards', label: 'shards', min: 1, max: 32 };
      default:
        return undefined;
    }
  },
  fieldVisible: (key, params) => {
    const a = str(params, 'architecture', 'primary-replica');
    if (key === 'readReplicas') return a === 'primary-replica';
    if (key === 'primaries' || key === 'writeCoordinationPct') return a === 'multi-primary';
    if (key === 'shards' || key === 'crossShardPct' || key === 'keyDistribution')
      return a === 'sharded';
    if (key === 'replicationLagMs') return a === 'primary-replica' || a === 'multi-primary';
    return true;
  },

  outflowFraction: () => 0,

  simSpec: (params) => {
    const mu = 1000 / num(params, 'queryTimeMs', 8);
    const pool = Math.max(1, Math.round(num(params, 'poolSize', 20)));
    const queueLimit = Math.max(0, Math.round(num(params, 'queueLimit', 100)));
    const a = str(params, 'architecture', 'primary-replica');
    const instances =
      a === 'primary-replica'
        ? 1 + Math.max(0, Math.round(num(params, 'readReplicas', 0)))
        : a === 'multi-primary'
          ? Math.max(1, Math.round(num(params, 'primaries', 3)))
          : a === 'sharded'
            ? Math.max(1, Math.round(num(params, 'shards', 4)))
            : 1;
    return {
      servers: pool * instances,
      serviceRate: mu,
      queueCap: bool(params, 'loadShedding', true) ? queueLimit * instances : Infinity,
      fixedLatencySec: 0,
      errorRate: num(params, 'intrinsicErrorRate', 0.0005),
      branchProb: 0,
    };
  },

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const pool = Math.max(1, Math.round(num(params, 'poolSize', 20)));
    if (inflow <= 0) return { metrics: idleMetrics(pool), explain: [] };

    const arch = str(params, 'architecture', 'primary-replica');
    const mu = 1000 / num(params, 'queryTimeMs', 8);
    const queueLimit = Math.max(0, Math.round(num(params, 'queueLimit', 100)));
    const readRatio = num(params, 'readRatio', 0.8);
    const intrinsic = num(params, 'intrinsicErrorRate', 0.0005);
    const shed = bool(params, 'loadShedding', true);
    const K = K_OF(pool, queueLimit);

    const instance = (lam: number, muX = mu): NodeMetrics =>
      metricsFromQueue(shed ? mmck(lam, muX, pool, K) : mmc(lam, muX, pool), {
        offered: lam,
        capacity: pool * muX,
        servers: pool,
        intrinsicErrorRate: intrinsic,
        downstreamErrorRate,
      });

    const reads = inflow * readRatio;
    const writes = inflow - reads;
    const explain: ExplainNote[] = [];

    if (arch === 'single') {
      const m = instance(inflow);
      explain.push({
        metric: 'rho',
        text: `Single primary — all ${inflow.toFixed(0)} req/s share one pool of ${pool} connections at ${num(params, 'queryTimeMs', 8)} ms ⇒ ρ = ${m.rho.toFixed(3)}.`,
        formula: 'ρ = λ / (poolSize · μ)',
        dominantTerm: m.rho > 0.85 ? 'connection-pool contention' : 'query time',
      });
      if (readRatio > 0.6) {
        explain.push({
          metric: 'rho',
          text: `${(readRatio * 100).toFixed(0)}% reads — switching to primary-replica or sharded would spread this load.`,
        });
      }
      return { metrics: m, explain };
    }

    if (arch === 'primary-replica') {
      const replicas = Math.max(0, Math.round(num(params, 'readReplicas', 0)));
      const primaryLambda = replicas > 0 ? writes : inflow;
      const primary = instance(primaryLambda);

      if (replicas === 0) {
        explain.push({
          metric: 'rho',
          text: `No read replicas yet — the primary carries all ${inflow.toFixed(0)} req/s (${(readRatio * 100).toFixed(0)}% reads). Add one to halve its load.`,
        });
        return { metrics: { ...primary, members: undefined }, explain };
      }

      const per = reads / replicas;
      const replicaM = instance(per);
      const parts = [
        { label: 'primary', role: 'primary' as const, offered: primaryLambda, m: primary },
        ...Array.from({ length: replicas }, (_, i) => ({
          label: `replica ${i + 1}`,
          role: 'read replica' as const,
          offered: per,
          m: replicaM,
        })),
      ];
      explain.push({
        metric: 'rho',
        text: `Writes (${writes.toFixed(0)} req/s) → primary; reads (${reads.toFixed(0)} req/s) split across ${replicas} replica(s) at ${per.toFixed(0)} req/s each. Busiest instance ρ = ${Math.max(primary.rho, replicaM.rho).toFixed(3)}.`,
        formula: 'ρ_replica = (λ · readRatio / replicas) / (poolSize · μ)',
      });
      explain.push({
        metric: 'errorRate',
        text: `Replicas trail the primary by ~${num(params, 'replicationLagMs', 50)} ms — reads there can be that stale.`,
      });
      return { metrics: blendMembers(parts), explain };
    }

    if (arch === 'multi-primary') {
      const n = Math.max(1, Math.round(num(params, 'primaries', 3)));
      const coord = num(params, 'writeCoordinationPct', 15) / 100;
      const writeMu = mu / (1 + coord * (n - 1)); // each write certified across n−1 peers
      const muEff = 1 / (readRatio / mu + (1 - readRatio) / writeMu); // read/write blend
      const per = inflow / n;
      const pm = metricsFromQueue(shed ? mmck(per, muEff, pool, K) : mmc(per, muEff, pool), {
        offered: per,
        capacity: pool * muEff,
        servers: pool,
        intrinsicErrorRate: intrinsic,
        downstreamErrorRate,
      });
      const parts = Array.from({ length: n }, (_, i) => ({
        label: `primary ${i + 1}`,
        role: 'primary' as const,
        offered: per,
        m: pm,
      }));
      explain.push({
        metric: 'rho',
        text: `${n} primaries share the load (${per.toFixed(0)} req/s each). Every write is certified across the other ${n - 1} — effective write time ${(1000 / writeMu).toFixed(1)} ms vs ${num(params, 'queryTimeMs', 8)} ms read. Per-node ρ = ${pm.rho.toFixed(3)}.`,
        formula: 'writeμ = μ / (1 + coordPct·(N−1))',
        dominantTerm:
          writes / inflow > 0.35 && n > 2 ? 'cross-node write coordination' : 'query time',
      });
      if (writes / inflow > 0.35 && n > 2) {
        explain.push({
          metric: 'rho',
          text: `Write-heavy (${((writes / inflow) * 100).toFixed(0)}%) — coordination overhead is eating the gains from extra primaries. Sharding writes by key scales better.`,
        });
      }
      return { metrics: blendMembers(parts), explain };
    }

    // sharded
    const n = Math.max(1, Math.round(num(params, 'shards', 4)));
    const cross = num(params, 'crossShardPct', 5) / 100;
    const dist = str(params, 'keyDistribution', 'uniform');
    const weights = dist === 'zipfian' ? zipfWeights(n) : Array.from({ length: n }, () => 1 / n);
    const ownLoad = inflow * (1 - cross);
    const fanout = inflow * cross; // every cross-shard query hits every shard
    const shardLambdas = weights.map((w) => ownLoad * w + fanout);
    const meanLambda = shardLambdas.reduce((s, x) => s + x, 0) / n;

    const parts = shardLambdas.map((lam, k) => ({
      label: `shard ${k}`,
      role: 'shard' as const,
      offered: lam,
      m: instance(lam),
      hot: lam > meanLambda * 1.4,
    }));
    const hot = parts.find((p) => p.hot);
    explain.push({
      metric: 'rho',
      text: `${n} shards, ${dist} keys. Each shard has its own pool of ${pool}; capacity scales with shard count.`,
      formula: 'λ_shard = λ·(1−crossShard)·keyWeight + λ·crossShard',
    });
    if (hot) {
      explain.push({
        metric: 'rho',
        text: `${hot.label} is hot at ρ ${hot.m.rho.toFixed(2)} — zipfian keys concentrate load on it. A better shard key, or more shards, rebalances.`,
        dominantTerm: 'key skew',
      });
    }
    if (cross > 0) {
      explain.push({
        metric: 'arrivalRate',
        text: `${(cross * 100).toFixed(0)}% of queries fan out to all ${n} shards — that scatter-gather adds ${fanout.toFixed(0)} req/s to every shard.`,
      });
    }
    return { metrics: blendMembers(parts), explain };
  },
};

/** Re-export so tests can assert the member shape without importing the model. */
export type { MemberMetrics };
