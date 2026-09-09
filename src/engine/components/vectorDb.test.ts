import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('vectorDb');
const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'v', type: 'vectorDb', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('vectorDb', () => {
  it('is a sink', () => {
    expect(m.routing).toBe('sink');
    expect(m.outflowFraction({})).toBe(0);
  });

  it('a flat index saturates where HNSW has headroom at the same load', () => {
    const base = { dimensions: 768, topK: 10, vectorCount: 2_000_000, ramGB: 64, poolSize: 64, queryTimeMs: 4 };
    const hnsw = solve({ ...base, indexType: 'hnsw' }, 3000);
    const flat = solve({ ...base, indexType: 'flat' }, 3000);
    expect(hnsw.metrics.overloaded).toBe(false);
    expect(flat.metrics.overloaded).toBe(true);
    expect(flat.metrics.latency.mean).toBeGreaterThan(hnsw.metrics.latency.mean * 20);
  });

  it('flips to memory-bound and slows 10×+ when the index does not fit in RAM', () => {
    const fits = solve({ indexType: 'hnsw', dimensions: 768, vectorCount: 2_000_000, ramGB: 32, poolSize: 64 }, 500);
    const spills = solve({ indexType: 'hnsw', dimensions: 768, vectorCount: 30_000_000, ramGB: 16, poolSize: 64 }, 500);
    expect(spills.metrics.latency.mean).toBeGreaterThan(fits.metrics.latency.mean * 10);
    expect(spills.explain.some((e) => /spill|disk|RAM/i.test(e.text))).toBe(true);
  });

  it('topK and dimensions scale the query cost', () => {
    const small = solve({ indexType: 'hnsw', topK: 10, dimensions: 384, ramGB: 64, poolSize: 64 }, 100);
    const big = solve({ indexType: 'hnsw', topK: 100, dimensions: 1536, ramGB: 64, poolSize: 64 }, 100);
    expect(big.metrics.latency.mean).toBeGreaterThan(small.metrics.latency.mean * 3);
  });

  it('IVF makes upserts cheaper than queries', () => {
    const base = { indexType: 'ivf', dimensions: 768, vectorCount: 2_000_000, ramGB: 64, poolSize: 32, queryTimeMs: 4 } as const;
    const readHeavy = solve({ ...base, writeRatio: 0 }, 2000);
    const writeHeavy = solve({ ...base, writeRatio: 1 }, 2000);
    expect(writeHeavy.metrics.rho).toBeLessThan(readHeavy.metrics.rho);
  });
});
