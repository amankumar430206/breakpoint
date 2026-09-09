import { z } from 'zod';
import { mm1, mmc, mmck } from '../queueing';
import { addLatency, blendMembers, metricsFromQueue } from './util';
import type { ExplainNote, MemberMetrics, NodeMetrics } from '../types';
import { bool, idleMetrics, num, str, type ComponentModel } from './types';

/**
 * Datastore engine families. The `architecture` knob picks a *replication
 * topology*; `engine` picks the *storage engine*, and the two are orthogonal.
 * The engine changes the math:
 *
 *  - readCostFactor / writeCostFactor scale the per-read / per-write service
 *    time (a document store denormalizes → cheaper reads; an LSM store like
 *    Cassandra has cheap appends but read amplification).
 *  - concurrencyModel says what binds first: a fixed connection `pool` (classic
 *    RDBMS) or raw `throughput` at a coordinator (Mongo / Dynamo / Redis), in
 *    which case `capacityRps` sizes the station instead of poolSize·μ.
 *  - writeLatencyAddMs is a fixed consensus penalty on writes (distributed SQL).
 *  - capDefault / nativeSharding / quorumWrites are read by the design advisor.
 */
export type DbEngine =
  | 'postgres'
  | 'mysql'
  | 'mongodb'
  | 'cassandra'
  | 'dynamodb'
  | 'redis'
  | 'cockroachdb'
  | 'prometheus'
  | 'influxdb'
  | 'timescale';

export interface DbEngineSpec {
  label: string;
  family: string;
  readCostFactor: number;
  writeCostFactor: number;
  concurrencyModel: 'pool' | 'throughput';
  capDefault: 'CP' | 'AP';
  nativeSharding: boolean;
  quorumWrites: boolean;
  writeLatencyAddMs: number;
  note: string;
  docHref: string;
}

export const DB_ENGINES: Record<DbEngine, DbEngineSpec> = {
  postgres: {
    label: 'PostgreSQL',
    family: 'relational',
    readCostFactor: 1,
    writeCostFactor: 1,
    concurrencyModel: 'pool',
    capDefault: 'CP',
    nativeSharding: false,
    quorumWrites: false,
    writeLatencyAddMs: 0,
    note: 'Relational — balanced read/write cost; the connection pool binds first; sharding is bolt-on.',
    docHref: 'concepts.md#relational',
  },
  mysql: {
    label: 'MySQL',
    family: 'relational',
    readCostFactor: 1,
    writeCostFactor: 1,
    concurrencyModel: 'pool',
    capDefault: 'CP',
    nativeSharding: false,
    quorumWrites: false,
    writeLatencyAddMs: 0,
    note: 'Relational — balanced read/write cost; the connection pool binds first; sharding is bolt-on.',
    docHref: 'concepts.md#relational',
  },
  mongodb: {
    label: 'MongoDB',
    family: 'document',
    readCostFactor: 0.7,
    writeCostFactor: 1.1,
    concurrencyModel: 'throughput',
    capDefault: 'AP',
    nativeSharding: true,
    quorumWrites: false,
    writeLatencyAddMs: 0,
    note: 'Document — denormalized reads are ~30% cheaper; throughput-bound at the coordinator; native sharding; AP by default.',
    docHref: 'concepts.md#document',
  },
  cassandra: {
    label: 'Cassandra',
    family: 'wide-column',
    readCostFactor: 1.5,
    writeCostFactor: 0.4,
    concurrencyModel: 'throughput',
    capDefault: 'AP',
    nativeSharding: true,
    quorumWrites: true,
    writeLatencyAddMs: 0,
    note: 'Wide-column LSM — writes ~2.5× cheaper than reads (read amplification); scales linearly with nodes; tunable quorum, AP.',
    docHref: 'concepts.md#wide-column',
  },
  dynamodb: {
    label: 'DynamoDB',
    family: 'managed KV',
    readCostFactor: 0.8,
    writeCostFactor: 1,
    concurrencyModel: 'throughput',
    capDefault: 'AP',
    nativeSharding: true,
    quorumWrites: false,
    writeLatencyAddMs: 0,
    note: 'Managed KV — provisioned capacity units bind first; predictable latency; hot partitions are the risk; eventual reads are cheaper.',
    docHref: 'concepts.md#managed-kv',
  },
  redis: {
    label: 'Redis (as primary store)',
    family: 'in-memory KV',
    readCostFactor: 0.15,
    writeCostFactor: 0.2,
    concurrencyModel: 'throughput',
    capDefault: 'AP',
    nativeSharding: false,
    quorumWrites: false,
    writeLatencyAddMs: 0,
    note: 'In-memory KV — sub-ms ops, throughput-bound; durability is a trade-off, not a given.',
    docHref: 'concepts.md#in-memory-kv',
  },
  cockroachdb: {
    label: 'CockroachDB / Spanner',
    family: 'distributed SQL',
    readCostFactor: 1.1,
    writeCostFactor: 1.3,
    concurrencyModel: 'pool',
    capDefault: 'CP',
    nativeSharding: true,
    quorumWrites: true,
    writeLatencyAddMs: 6,
    note: 'Distributed SQL — SQL semantics kept; every write pays a Raft consensus round-trip; horizontal scale is built in; CP.',
    docHref: 'concepts.md#distributed-sql',
  },
  prometheus: {
    label: 'Prometheus',
    family: 'time-series',
    readCostFactor: 2,
    writeCostFactor: 0.08,
    concurrencyModel: 'throughput',
    capDefault: 'AP',
    nativeSharding: true,
    quorumWrites: false,
    writeLatencyAddMs: 0,
    note: 'Time-series — scrape ingest is almost free; PromQL range queries over many series are the expensive path; scales by federation / sharding.',
    docHref: 'concepts.md#time-series',
  },
  influxdb: {
    label: 'InfluxDB',
    family: 'time-series',
    readCostFactor: 1.4,
    writeCostFactor: 0.1,
    concurrencyModel: 'throughput',
    capDefault: 'AP',
    nativeSharding: true,
    quorumWrites: false,
    writeLatencyAddMs: 0,
    note: 'Time-series — line-protocol writes batch cheaply (TSM engine); range + downsampling reads cost more; throughput-bound.',
    docHref: 'concepts.md#time-series',
  },
  timescale: {
    label: 'TimescaleDB',
    family: 'time-series',
    readCostFactor: 1.2,
    writeCostFactor: 0.25,
    concurrencyModel: 'throughput',
    capDefault: 'AP',
    nativeSharding: true,
    quorumWrites: false,
    writeLatencyAddMs: 0,
    note: 'Time-series on Postgres — hypertable chunking + compression make writes cheap; keeps SQL for the read side.',
    docHref: 'concepts.md#time-series',
  },
};

const engineOf = (params: Record<string, unknown>): DbEngineSpec =>
  DB_ENGINES[str(params, 'engine', 'postgres') as DbEngine] ?? DB_ENGINES.postgres;

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
    engine: 'postgres',
    queryTimeMs: 8,
    poolSize: 20,
    capacityRps: 200000,
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
    engine: z
      .enum([
        'postgres',
        'mysql',
        'mongodb',
        'cassandra',
        'dynamodb',
        'redis',
        'cockroachdb',
        'prometheus',
        'influxdb',
        'timescale',
      ])
      .default('postgres'),
    queryTimeMs: z.number().positive().max(60000).default(8),
    poolSize: z.number().int().positive().max(10000).default(20),
    capacityRps: z.number().positive().max(50000000).default(200000),
    queueLimit: z.number().int().nonnegative().max(200000).default(100),
    loadShedding: z.boolean().default(true),
    readRatio: z.number().min(0).max(1).default(0.8),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.0005),
    readReplicas: z.number().int().nonnegative().max(64).default(0),
    primaries: z.number().int().min(1).max(32).default(3),
    shards: z.number().int().min(1).max(1024).default(4),
    replicationLagMs: z.number().nonnegative().max(60000).default(50),
    writeCoordinationPct: z.number().min(0).max(200).default(15),
    crossShardPct: z.number().min(0).max(100).default(5),
    keyDistribution: z.enum(['uniform', 'zipfian']).default('uniform'),
  }),
  paramDocs: {
    architecture: 'Replication topology — changes which sub-options apply.',
    engine:
      'Storage engine family. Changes read/write cost, what binds first (pool vs throughput), and consensus penalty.',
    queryTimeMs: 'Mean query execution time at cost factor 1.0 (exponential).',
    poolSize: 'Connections per instance — the concurrency limit (pool engines).',
    capacityRps: 'Sustained ops/sec per instance before saturation (throughput engines).',
    queueLimit: 'Requests that may wait for a connection before erroring.',
    loadShedding: 'On: pool full → query errors fast. Off: unbounded wait.',
    readRatio: 'Fraction of queries that are reads.',
    intrinsicErrorRate: 'Baseline query error rate.',
    readReplicas: 'Async read replicas (primary-replica). Reads spread across them.',
    primaries: 'Primary nodes that all accept reads + writes (multi-primary).',
    shards: 'Independent shards partitioning the keyspace (sharded).',
    replicationLagMs:
      'How far replicas trail the primary. Adds latency to replica reads in proportion to the write mix (read-your-writes wait).',
    writeCoordinationPct: 'Extra write cost per additional primary (cross-node certification).',
    crossShardPct: 'Share of queries that fan out to every shard (scatter-gather).',
    keyDistribution: 'uniform = even shards; zipfian = one hot shard.',
  },
  scaleParam: (params) => {
    switch (str(params, 'architecture', 'primary-replica')) {
      case 'primary-replica':
        return { key: 'readReplicas', label: 'read replicas', min: 0, max: 64 };
      case 'multi-primary':
        return { key: 'primaries', label: 'primaries', min: 1, max: 32 };
      case 'sharded':
        return { key: 'shards', label: 'shards', min: 1, max: 512 };
      default:
        return undefined;
    }
  },
  // Managed DB instance classes — the connection pool scales with the box, and a
  // memory-optimized class also serves reads a little faster from a bigger cache.
  presetLegend: 'connection pool size',
  presets: [
    { label: '40', hint: 'db.t3.medium — 2 vCPU / 4 GB (~40 connections)', patch: { poolSize: 40 } },
    { label: '90', hint: 'db.m5.large — 2 vCPU / 8 GB (~90)', patch: { poolSize: 90 } },
    { label: '180', hint: 'db.m5.xlarge — 4 vCPU / 16 GB (~180)', patch: { poolSize: 180 } },
    { label: '180+', hint: 'db.r5.xlarge — mem-optimized, 4 vCPU / 32 GB (faster reads)', patch: { poolSize: 180, queryTimeMs: 5 } },
    { label: '350', hint: 'db.m5.2xlarge — 8 vCPU / 32 GB (~350)', patch: { poolSize: 350 } },
    { label: '700', hint: 'db.m5.4xlarge — 16 vCPU / 64 GB (~700)', patch: { poolSize: 700 } },
  ],
  fieldVisible: (key, params) => {
    const a = str(params, 'architecture', 'primary-replica');
    const throughput = engineOf(params).concurrencyModel === 'throughput';
    if (key === 'poolSize' || key === 'queueLimit' || key === 'loadShedding') return !throughput;
    if (key === 'capacityRps') return throughput;
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
    const eng = engineOf(params);
    const rr = num(params, 'readRatio', 0.8);
    const muRead = mu / eng.readCostFactor;
    const muWrite = mu / eng.writeCostFactor;
    const muMixed = 1 / (rr / muRead + (1 - rr) / muWrite);
    const instances =
      a === 'primary-replica'
        ? 1 + Math.max(0, Math.round(num(params, 'readReplicas', 0)))
        : a === 'multi-primary'
          ? Math.max(1, Math.round(num(params, 'primaries', 3)))
          : a === 'sharded'
            ? Math.max(1, Math.round(num(params, 'shards', 4)))
            : 1;
    // Blended read-your-writes staleness wait: the analytical model charges
    // lag·(1−readRatio)·½ to replica-served reads; here that is spread across the
    // whole station's traffic (reads on replicas ≈ readRatio of it).
    const replicas = a === 'primary-replica' ? Math.max(0, Math.round(num(params, 'readReplicas', 0))) : 0;
    const stalePenaltySec =
      replicas > 0 ? (num(params, 'replicationLagMs', 50) / 1000) * (1 - rr) * 0.5 * rr : 0;
    const writeLatSec = ((1 - rr) * eng.writeLatencyAddMs) / 1000;
    const fixedLatencySec = stalePenaltySec + writeLatSec;
    const errorRate = num(params, 'intrinsicErrorRate', 0.0005);

    if (eng.concurrencyModel === 'throughput') {
      const capEff = Math.max(1, num(params, 'capacityRps', 200000)) * (muMixed / mu);
      return {
        servers: instances,
        serviceRate: capEff,
        queueCap: Infinity,
        fixedLatencySec,
        errorRate,
        branchProb: 0,
      };
    }
    return {
      servers: pool * instances,
      serviceRate: muMixed,
      queueCap: bool(params, 'loadShedding', true) ? queueLimit * instances : Infinity,
      fixedLatencySec,
      errorRate,
      branchProb: 0,
    };
  },

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const pool = Math.max(1, Math.round(num(params, 'poolSize', 20)));
    if (inflow <= 0) return { metrics: idleMetrics(pool), explain: [] };

    const arch = str(params, 'architecture', 'primary-replica');
    const eng = engineOf(params);
    const mu = 1000 / num(params, 'queryTimeMs', 8);
    const muRead = mu / eng.readCostFactor;
    const muWrite = mu / eng.writeCostFactor;
    const muBlend = (rf: number) => 1 / (rf / muRead + (1 - rf) / muWrite);
    const queueLimit = Math.max(0, Math.round(num(params, 'queueLimit', 100)));
    const readRatio = num(params, 'readRatio', 0.8);
    const intrinsic = num(params, 'intrinsicErrorRate', 0.0005);
    const shed = bool(params, 'loadShedding', true);
    const K = K_OF(pool, queueLimit);
    const capRps = Math.max(1, num(params, 'capacityRps', 200000));
    // Fixed consensus round-trip on the write path (distributed SQL).
    const writeLatSec = ((1 - readRatio) * eng.writeLatencyAddMs) / 1000;

    /** One datastore instance carrying a `rf`-read mix at rate `lam`.
     *  pool engines: M/M/c/K over the connection pool at the blended service
     *  rate; throughput engines: M/M/1 at the (cost-adjusted) capacity. */
    const instance = (lam: number, rf = readRatio): NodeMetrics => {
      const muX = muBlend(rf);
      if (eng.concurrencyModel === 'throughput') {
        const capEff = capRps * (muX / mu);
        return metricsFromQueue(mm1(lam, capEff), {
          offered: lam,
          capacity: capEff,
          servers: 1,
          intrinsicErrorRate: intrinsic,
          downstreamErrorRate,
        });
      }
      return metricsFromQueue(shed ? mmck(lam, muX, pool, K) : mmc(lam, muX, pool), {
        offered: lam,
        capacity: pool * muX,
        servers: pool,
        intrinsicErrorRate: intrinsic,
        downstreamErrorRate,
      });
    };
    const withWriteLat = (m: NodeMetrics): NodeMetrics => addLatency(m, writeLatSec);

    const reads = inflow * readRatio;
    const writes = inflow - reads;
    const explain: ExplainNote[] = [];
    if (str(params, 'engine', 'postgres') !== 'postgres') {
      explain.push({ metric: 'rho', text: `${eng.label} — ${eng.note}` });
    }

    if (arch === 'single') {
      const m = withWriteLat(instance(inflow));
      const bind =
        eng.concurrencyModel === 'throughput'
          ? `${capRps.toFixed(0)} ops/s capacity`
          : `one pool of ${pool} connections`;
      explain.push({
        metric: 'rho',
        text: `Single node — all ${inflow.toFixed(0)} req/s share ${bind} ⇒ ρ = ${m.rho.toFixed(3)}.`,
        formula:
          eng.concurrencyModel === 'throughput' ? 'ρ = λ / capacityRps' : 'ρ = λ / (poolSize · μ)',
        dominantTerm:
          m.rho > 0.85
            ? eng.concurrencyModel === 'throughput'
              ? 'throughput ceiling'
              : 'connection-pool contention'
            : 'query time',
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
      const primary = withWriteLat(instance(primaryLambda, replicas > 0 ? 0 : readRatio));

      if (replicas === 0) {
        explain.push({
          metric: 'rho',
          text: `No read replicas yet — the primary carries all ${inflow.toFixed(0)} req/s (${(readRatio * 100).toFixed(0)}% reads). Add one to halve its load.`,
        });
        return { metrics: { ...primary, members: undefined }, explain };
      }

      const per = reads / replicas;
      // Replication lag only bites when a read closely follows a write to the
      // same key (read-your-writes); the write fraction is a workload proxy for
      // how often that happens, and the expected wait is ~half the lag window.
      const lagSec = num(params, 'replicationLagMs', 50) / 1000;
      const stalePenaltySec = lagSec * (1 - readRatio) * 0.5;
      const replicaM = addLatency(instance(per, 1), stalePenaltySec);
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
        metric: 'latency',
        text:
          stalePenaltySec > 0
            ? `Replicas trail the primary by ~${num(params, 'replicationLagMs', 50)} ms. With ${((1 - readRatio) * 100).toFixed(0)}% writes, read-your-writes adds ~${(stalePenaltySec * 1000).toFixed(0)} ms to replica reads.`
            : `Replicas trail the primary by ~${num(params, 'replicationLagMs', 50)} ms, but this pure-read workload never reads its own recent writes — no staleness penalty.`,
      });
      return { metrics: blendMembers(parts), explain };
    }

    if (arch === 'multi-primary') {
      const n = Math.max(1, Math.round(num(params, 'primaries', 3)));
      const coord = num(params, 'writeCoordinationPct', 15) / 100;
      const writeMu = muWrite / (1 + coord * (n - 1)); // each write certified across n−1 peers
      const muEff = 1 / (readRatio / muRead + (1 - readRatio) / writeMu); // read/write blend
      const per = inflow / n;
      const pm = withWriteLat(
        metricsFromQueue(shed ? mmck(per, muEff, pool, K) : mmc(per, muEff, pool), {
          offered: per,
          capacity: pool * muEff,
          servers: pool,
          intrinsicErrorRate: intrinsic,
          downstreamErrorRate,
        }),
      );
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
    return { metrics: withWriteLat(blendMembers(parts)), explain };
  },
};

/** Re-export so tests can assert the member shape without importing the model. */
export type { MemberMetrics };
