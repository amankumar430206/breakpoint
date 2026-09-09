import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('sqlDatabase');

const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'db', type: 'sqlDatabase', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('sqlDatabase — architectures', () => {
  it('single: one member, all traffic on the primary', () => {
    const r = solve({ architecture: 'single', queryTimeMs: 5, poolSize: 20 }, 2000);
    expect(r.metrics.members).toBeUndefined();
    expect(r.metrics.rho).toBeCloseTo(2000 / (20 * (1000 / 5)), 4);
  });

  it('primary-replica: reads spread across replicas, writes stay on the primary', () => {
    const base = { architecture: 'primary-replica', queryTimeMs: 5, poolSize: 10, readRatio: 0.9 };
    const one = solve({ ...base, readReplicas: 1 }, 3000);
    const three = solve({ ...base, readReplicas: 3 }, 3000);

    expect(one.metrics.members).toHaveLength(2); // primary + 1
    expect(three.metrics.members).toHaveLength(4); // primary + 3
    // each replica in the 3-replica case sees a third of the reads → much lower ρ
    const rep1 = one.metrics.members!.find((x) => x.role === 'read replica')!;
    const rep3 = three.metrics.members!.find((x) => x.role === 'read replica')!;
    expect(rep3.rho).toBeLessThan(rep1.rho * 0.5);
  });

  it('multi-primary: per-node write capacity drops as primaries are added', () => {
    // write-heavy so coordination overhead bites
    const p = { architecture: 'multi-primary', queryTimeMs: 4, poolSize: 20, readRatio: 0.2, writeCoordinationPct: 25 };
    const n2 = solve({ ...p, primaries: 2 }, 4000);
    const n6 = solve({ ...p, primaries: 6 }, 4000);
    // 3× the primaries but nowhere near 3× the effective throughput headroom
    expect(n6.metrics.members).toHaveLength(6);
    expect(n6.metrics.rho).toBeGreaterThan(n2.metrics.rho / 3);
  });

  it('sharded: zipfian keys create a flagged hot shard', () => {
    const uni = solve({ architecture: 'sharded', shards: 4, keyDistribution: 'uniform', queryTimeMs: 6, poolSize: 15 }, 6000);
    const zip = solve({ architecture: 'sharded', shards: 4, keyDistribution: 'zipfian', queryTimeMs: 6, poolSize: 15 }, 6000);

    expect(uni.metrics.members!.every((x) => !x.hot)).toBe(true);
    expect(zip.metrics.members![0].hot).toBe(true);
    expect(zip.metrics.members![0].rho).toBeGreaterThan(zip.metrics.members![3].rho * 2);
  });

  it('sharded: more shards lower the per-shard load', () => {
    const s4 = solve({ architecture: 'sharded', shards: 4, queryTimeMs: 6, poolSize: 12 }, 8000);
    const s8 = solve({ architecture: 'sharded', shards: 8, queryTimeMs: 6, poolSize: 12 }, 8000);
    expect(s8.metrics.rho).toBeLessThan(s4.metrics.rho * 0.6);
  });

  it('sharded: cross-shard queries fan out to every shard', () => {
    const noCross = solve({ architecture: 'sharded', shards: 4, crossShardPct: 0, queryTimeMs: 6, poolSize: 12 }, 4000);
    const withCross = solve({ architecture: 'sharded', shards: 4, crossShardPct: 50, queryTimeMs: 6, poolSize: 12 }, 4000);
    // every shard carries extra scatter-gather load
    expect(withCross.metrics.members![0].arrivalRate).toBeGreaterThan(
      noCross.metrics.members![0].arrivalRate,
    );
  });

  it('primary-replica: replication lag slows replica reads in proportion to the write mix', () => {
    const base = {
      architecture: 'primary-replica',
      queryTimeMs: 4,
      poolSize: 40,
      readReplicas: 3,
    };
    // low load so latency is dominated by service time + lag, not queueing
    const noLag = solve({ ...base, readRatio: 0.7, replicationLagMs: 0 }, 400);
    const withLag = solve({ ...base, readRatio: 0.7, replicationLagMs: 200 }, 400);
    const rep = (r: ReturnType<typeof solve>) =>
      r.metrics.members!.find((x) => x.role === 'read replica')!;
    const pri = (r: ReturnType<typeof solve>) =>
      r.metrics.members!.find((x) => x.role === 'primary')!;

    // replica p99 climbs with the lag; the primary is untouched
    expect(rep(withLag).latencyP99).toBeGreaterThan(rep(noLag).latencyP99 + 0.01);
    expect(pri(withLag).latencyP99).toBeCloseTo(pri(noLag).latencyP99, 4);

    // pure-read workload never reads its own writes → no penalty
    const pureRead = solve({ ...base, readRatio: 1, replicationLagMs: 200 }, 400);
    const pureReadNoLag = solve({ ...base, readRatio: 1, replicationLagMs: 0 }, 400);
    expect(rep(pureRead).latencyP99).toBeCloseTo(rep(pureReadNoLag).latencyP99, 4);

    // write-heavier mix pays a bigger staleness wait than a read-heavy one
    const readHeavy = solve({ ...base, readRatio: 0.9, replicationLagMs: 200 }, 400);
    const writeHeavy = solve({ ...base, readRatio: 0.5, replicationLagMs: 200 }, 400);
    expect(rep(writeHeavy).latencyP99).toBeGreaterThan(rep(readHeavy).latencyP99);
  });

  it('engine cost factors decide which traffic mix saturates', () => {
    const load = 60_000;
    const mongo = (readRatio: number) =>
      solve(
        { engine: 'mongodb', architecture: 'single', capacityRps: 50_000, queryTimeMs: 1, readRatio },
        load,
      );
    const cass = (readRatio: number) =>
      solve(
        { engine: 'cassandra', architecture: 'single', capacityRps: 50_000, queryTimeMs: 1, readRatio },
        load,
      );
    // read-heavy: Mongo's denormalized reads keep ρ lower than Cassandra's read-amplified ones
    expect(mongo(0.95).metrics.rho).toBeLessThan(cass(0.95).metrics.rho);
    // write-heavy: Cassandra's LSM appends keep ρ lower than Mongo's
    expect(cass(0.15).metrics.rho).toBeLessThan(mongo(0.15).metrics.rho);
  });

  it('throughput engines size on capacityRps, not poolSize', () => {
    const base = { engine: 'mongodb', architecture: 'single', capacityRps: 40_000, queryTimeMs: 2 } as const;
    const small = solve({ ...base, poolSize: 5 }, 30_000);
    const big = solve({ ...base, poolSize: 500 }, 30_000);
    expect(small.metrics.rho).toBeCloseTo(big.metrics.rho, 6); // poolSize is inert here
    const moreCap = solve({ ...base, poolSize: 5, capacityRps: 120_000 }, 30_000);
    expect(moreCap.metrics.rho).toBeLessThan(small.metrics.rho); // capacityRps is the knob
  });

  it('pool engines still bind on poolSize', () => {
    const base = { engine: 'postgres', architecture: 'single', queryTimeMs: 5 } as const;
    const small = solve({ ...base, poolSize: 10 }, 3000);
    const big = solve({ ...base, poolSize: 40 }, 3000);
    expect(big.metrics.rho).toBeLessThan(small.metrics.rho * 0.5);
  });

  it('distributed SQL adds a write-consensus latency penalty', () => {
    const p = { architecture: 'single', queryTimeMs: 4, poolSize: 50, readRatio: 0.5 } as const;
    const pg = solve({ ...p, engine: 'postgres' }, 500);
    const crdb = solve({ ...p, engine: 'cockroachdb' }, 500);
    expect(crdb.metrics.latency.mean).toBeGreaterThan(pg.metrics.latency.mean + 0.002);
  });

  it('fieldVisible follows the engine concurrency model', () => {
    expect(m.fieldVisible!('poolSize', { engine: 'mongodb' })).toBe(false);
    expect(m.fieldVisible!('capacityRps', { engine: 'mongodb' })).toBe(true);
    expect(m.fieldVisible!('poolSize', { engine: 'postgres' })).toBe(true);
    expect(m.fieldVisible!('capacityRps', { engine: 'postgres' })).toBe(false);
  });

  it('time-series engines soak up a write-heavy ingest a same-capacity postgres cannot', () => {
    const load = 25_000;
    const writeHeavy = { architecture: 'single', queryTimeMs: 1, readRatio: 0.1 } as const;
    const pg = solve({ ...writeHeavy, engine: 'postgres', poolSize: 10 }, load); // cap ≈ 10k
    const prom = solve({ ...writeHeavy, engine: 'prometheus', capacityRps: 10_000 }, load);
    expect(pg.metrics.overloaded).toBe(true);
    expect(prom.metrics.overloaded).toBe(false);

    // but a read (range-query) heavy mix hits Prometheus' read amplification
    const readHeavy = solve(
      { architecture: 'single', queryTimeMs: 1, readRatio: 0.9, engine: 'prometheus', capacityRps: 10_000 },
      load,
    );
    expect(readHeavy.metrics.rho).toBeGreaterThan(prom.metrics.rho * 2);
  });

  it('engine defaults to postgres and leaves the pool model untouched', () => {
    const withEngine = solve({ architecture: 'single', engine: 'postgres', queryTimeMs: 5, poolSize: 20 }, 2000);
    const noEngine = solve({ architecture: 'single', queryTimeMs: 5, poolSize: 20 }, 2000);
    expect(withEngine.metrics.rho).toBeCloseTo(noEngine.metrics.rho, 10);
  });

  it('scaleParam adapts to the architecture', () => {
    const sp = (arch: string) =>
      typeof m.scaleParam === 'function' ? m.scaleParam({ architecture: arch }) : m.scaleParam;
    expect(sp('single')).toBeUndefined();
    expect(sp('primary-replica')?.key).toBe('readReplicas');
    expect(sp('multi-primary')?.key).toBe('primaries');
    expect(sp('sharded')?.key).toBe('shards');
  });

  it('fieldVisible hides options that do not apply', () => {
    expect(m.fieldVisible!('shards', { architecture: 'primary-replica' })).toBe(false);
    expect(m.fieldVisible!('shards', { architecture: 'sharded' })).toBe(true);
    expect(m.fieldVisible!('readReplicas', { architecture: 'sharded' })).toBe(false);
    expect(m.fieldVisible!('queryTimeMs', { architecture: 'sharded' })).toBe(true);
  });
});
