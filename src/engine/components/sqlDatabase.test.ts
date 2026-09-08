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
