import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';
import type { SolveNodeCtx } from './types';

const m = getModel('apiGateway');
const ctx = (over: Partial<SolveNodeCtx>): SolveNodeCtx => ({
  node: { id: 'gw', type: 'apiGateway', position: { x: 0, y: 0 }, params: {} },
  params: { ...m.defaultParams, ...(over.params ?? {}) },
  inflow: 0,
  downstreamErrorRate: 0,
  ...over,
});

describe('apiGateway', () => {
  it('admits up to the rate limit and 429s the rest', () => {
    const under = m.solve(ctx({ params: { rateLimitRps: 10000, capacityRps: 50000 }, inflow: 6000 }));
    expect(under.metrics.dropRate).toBe(0);
    expect(under.metrics.overloaded).toBe(false);

    const over = m.solve(ctx({ params: { rateLimitRps: 10000, capacityRps: 50000 }, inflow: 40000 }));
    expect(over.metrics.dropRate).toBeCloseTo(1 - 10000 / 40000, 6);
    expect(over.metrics.overloaded).toBe(true);
    expect(over.metrics.throughput).toBeLessThanOrEqual(10000);
  });

  it('outflowFraction sheds the 429s so the backend sees only the admitted rate', () => {
    expect(m.outflowFraction({ ...m.defaultParams, rateLimitRps: 10000, capacityRps: 50000 }, { inflow: 40000 })).toBeCloseTo(
      0.25,
      6,
    );
    expect(m.outflowFraction({ ...m.defaultParams, rateLimitRps: 10000 }, { inflow: 5000 })).toBe(1);
  });

  it('binds on processing capacity when it is below the rate limit', () => {
    const r = m.solve(ctx({ params: { capacityRps: 2000, instances: 1, rateLimitRps: 100000 }, inflow: 5000 }));
    expect(r.metrics.overloaded).toBe(true);
    expect(r.metrics.dropRate).toBeCloseTo(1 - 2000 / 5000, 6);
    expect(r.explain[0].dominantTerm).toBe('gateway capacity');
  });

  it('adds a flat auth latency and scales out on instances', () => {
    const r = m.solve(ctx({ params: { authLatencyMs: 8, capacityRps: 50000, instances: 2 }, inflow: 1000 }));
    expect(r.metrics.latency.p99).toBeCloseTo(0.008, 6);
    expect(m.scaleParam).toMatchObject({ key: 'instances' });
    // two instances raise the binding rate when capacity was the limit
    const solo = m.solve(ctx({ params: { capacityRps: 3000, instances: 1, rateLimitRps: 1e6 }, inflow: 5000 }));
    const pair = m.solve(ctx({ params: { capacityRps: 3000, instances: 2, rateLimitRps: 1e6 }, inflow: 5000 }));
    expect(solo.metrics.overloaded).toBe(true);
    expect(pair.metrics.overloaded).toBe(false);
  });

  it('folds downstream failure into its error rate', () => {
    const r = m.solve(ctx({ params: { authErrorRate: 0.01 }, inflow: 1000, downstreamErrorRate: 0.2 }));
    // caller-visible failure ≈ 1 − (1−0.01)(1−0.2)
    expect(r.metrics.throughput / r.metrics.arrivalRate).toBeLessThan(0.81);
  });
});
