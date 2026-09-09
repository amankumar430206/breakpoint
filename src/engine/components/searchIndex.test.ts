import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('searchIndex');
const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'es', type: 'searchIndex', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('searchIndex', () => {
  it('is a sink', () => {
    expect(m.routing).toBe('sink');
    expect(m.outflowFraction({})).toBe(0);
  });

  it('more shards make each shard smaller + faster ⇒ lower per-shard load', () => {
    const base = { queryTimeMs: 60, poolSize: 20, readRatio: 0.9, replicas: 0 } as const;
    const s4 = solve({ ...base, shards: 4 }, 1000);
    const s16 = solve({ ...base, shards: 16 }, 1000);
    const rho = (r: ReturnType<typeof solve>) => r.metrics.members![0].rho;
    expect(rho(s16)).toBeLessThan(rho(s4) * 0.5);
  });

  it('query p99 tracks the slowest shard, not the average (scatter-gather)', () => {
    const uni = solve({ shards: 6, keyDistribution: 'uniform', queryTimeMs: 60, poolSize: 40, readRatio: 1 }, 1200);
    const zip = solve({ shards: 6, keyDistribution: 'zipfian', queryTimeMs: 60, poolSize: 40, readRatio: 1 }, 1200);
    // the hot shard holds ~40% of the data → it's both busier and slower per
    // query, and the whole scatter-gather waits for it
    expect(zip.metrics.latency.p99).toBeGreaterThan(uni.metrics.latency.p99 * 1.5);
    expect(zip.metrics.members![0].hot).toBe(true);
    expect(uni.metrics.members!.every((mm) => !mm.hot)).toBe(true);
  });

  it('replicas spread query load', () => {
    const base = { shards: 4, queryTimeMs: 12, poolSize: 16, readRatio: 1 } as const;
    const r0 = solve({ ...base, replicas: 0 }, 4000);
    const r2 = solve({ ...base, replicas: 2 }, 4000);
    expect(r2.metrics.members![0].rho).toBeLessThan(r0.metrics.members![0].rho * 0.5);
  });

  it('refresh interval adds to the read-your-writes path only when indexing', () => {
    const idx = solve({ shards: 4, replicas: 1, poolSize: 40, readRatio: 0.5, refreshIntervalSec: 4, queryTimeMs: 5 }, 400);
    const pureRead = solve({ shards: 4, replicas: 1, poolSize: 40, readRatio: 1, refreshIntervalSec: 4, queryTimeMs: 5 }, 400);
    // 50% indexing, 4 s refresh → ~+1 s on the aggregate
    expect(idx.metrics.latency.mean).toBeGreaterThan(pureRead.metrics.latency.mean + 0.5);
  });

  it('flags a missing replica on a read-heavy index', () => {
    const r = solve({ shards: 4, replicas: 0, readRatio: 0.9, poolSize: 40 }, 400);
    expect(r.explain.some((e) => /replica/i.test(e.text))).toBe(true);
  });
});
