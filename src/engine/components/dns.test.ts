import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('dns');
const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'dns', type: 'dns', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('dns', () => {
  it('passes traffic through and is never the bottleneck', () => {
    expect(m.routing).toBe('passthrough');
    expect(m.outflowFraction({})).toBe(1);
    const r = solve({ resolveLatencyMs: 1, cacheHitRatio: 0.95 }, 100_000);
    expect(r.metrics.rho).toBeLessThan(0.05);
    expect(r.metrics.overloaded).toBe(false);
  });

  it('adds only the blended (uncached) resolution latency', () => {
    const cached = solve({ resolveLatencyMs: 20, cacheHitRatio: 1 }, 1000);
    const cold = solve({ resolveLatencyMs: 20, cacheHitRatio: 0.5 }, 1000);
    expect(cached.metrics.latency.mean).toBeCloseTo(0, 4);
    expect(cold.metrics.latency.mean).toBeCloseTo(0.01, 4); // 0.5 · 20 ms
  });

  it('explains failover behaviour by policy', () => {
    expect(solve({ routingPolicy: 'simple' }, 100).explain.some((e) => /no failover|total outage/i.test(e.text))).toBe(true);
    expect(solve({ routingPolicy: 'failover', ttlSec: 30, healthCheckSec: 10 }, 100).explain.some((e) => /routes away|failover/i.test(e.text))).toBe(true);
  });
});
