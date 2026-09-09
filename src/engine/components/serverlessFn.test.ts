import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';
import type { SolveNodeCtx } from './types';

const m = getModel('serverlessFn');
const ctx = (over: Partial<SolveNodeCtx>): SolveNodeCtx => ({
  node: { id: 'fn', type: 'serverlessFn', position: { x: 0, y: 0 }, params: {} },
  params: { ...m.defaultParams, ...(over.params ?? {}) },
  inflow: 0,
  downstreamErrorRate: 0,
  ...over,
});

describe('serverlessFn', () => {
  it('blends the cold-start penalty into the effective execution time', () => {
    const warm = m.solve(ctx({ params: { execTimeMs: 50, coldStartMs: 500, coldStartRate: 0, maxConcurrency: 100000 }, inflow: 100 }));
    const cold = m.solve(ctx({ params: { execTimeMs: 50, coldStartMs: 500, coldStartRate: 0.2, maxConcurrency: 100000 }, inflow: 100 }));
    // warm ≈ 50 ms; with 20% cold at +500 ms ⇒ ≈ 150 ms
    expect(warm.metrics.latency.mean).toBeCloseTo(0.05, 3);
    expect(cold.metrics.latency.mean).toBeGreaterThan(0.13);
  });

  it('throttles (429) once concurrent demand exceeds maxConcurrency', () => {
    // 2000 req/s × 60 ms ⇒ ~120 concurrent needed; ceiling 50 ⇒ heavy throttling
    const r = m.solve(ctx({ params: { execTimeMs: 60, coldStartRate: 0, maxConcurrency: 50 }, inflow: 2000 }));
    expect(r.metrics.dropRate).toBeGreaterThan(0.4);
    expect(r.metrics.overloaded).toBe(true);
    expect(r.metrics.throughput).toBeLessThan(1000);
  });

  it('has headroom below the ceiling', () => {
    const r = m.solve(ctx({ params: { execTimeMs: 60, coldStartRate: 0, maxConcurrency: 2000 }, inflow: 2000 }));
    // needs ~120 of 2000 ⇒ negligible loss
    expect(r.metrics.dropRate).toBeLessThan(0.001);
    expect(r.metrics.overloaded).toBe(false);
  });

  it('outflowFraction drops the throttled fraction', () => {
    const p = { ...m.defaultParams, execTimeMs: 60, coldStartRate: 0, maxConcurrency: 50 };
    expect(m.outflowFraction(p, { inflow: 2000 })).toBeLessThan(0.6);
    expect(m.outflowFraction(p, { inflow: 100 })).toBeCloseTo(1, 2);
  });

  it('raising the concurrency limit clears throttling', () => {
    const base = { execTimeMs: 60, coldStartRate: 0 } as const;
    const tight = m.solve(ctx({ params: { ...base, maxConcurrency: 50 }, inflow: 2000 }));
    const loose = m.solve(ctx({ params: { ...base, maxConcurrency: 5000 }, inflow: 2000 }));
    expect(tight.metrics.overloaded).toBe(true);
    expect(loose.metrics.overloaded).toBe(false);
  });

  it('exposes the cold-start spec to the DES', () => {
    const s = m.simSpec({ coldStartRate: 0.1, coldStartMs: 300, execTimeMs: 40, maxConcurrency: 500 });
    expect(s.servers).toBe(500);
    expect(s.queueCap).toBe(0);
    expect(s.serviceRate).toBeCloseTo(1000 / 40, 6); // warm rate; penalty added per-invocation
    expect(s.coldStart).toEqual({ rate: 0.1, extraSec: 0.3 });
  });
});
