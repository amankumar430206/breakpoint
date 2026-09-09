import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('notificationService');
const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'n', type: 'notificationService', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('notificationService', () => {
  it('is a sink', () => {
    expect(m.routing).toBe('sink');
    expect(m.outflowFraction({})).toBe(0);
  });

  it('async: sustained rate above the provider limit grows a backlog, not errors', () => {
    const r = solve({ providerRateLimitRps: 200, asyncBuffer: true, providerErrorRate: 0.02 }, 500);
    expect(r.metrics.overloaded).toBe(true);
    expect(r.metrics.backlogGrowth).toBeCloseTo(300, 0);
    expect(r.metrics.dropRate).toBe(0);
    expect(r.metrics.errorRate).toBeCloseTo(0.02, 6); // just the provider bounce rate
  });

  it('asyncBuffer off: over the limit is rejected instead of buffered', () => {
    const r = solve({ providerRateLimitRps: 200, asyncBuffer: false }, 500);
    expect(r.metrics.dropRate).toBeCloseTo(1 - 200 / 500, 6);
    expect(r.metrics.backlogGrowth).toBe(0);
  });

  it('tail latency is send time + jitter', () => {
    const r = solve({ sendLatencyMs: 300, jitterMs: 150, providerRateLimitRps: 10000 }, 100);
    expect(r.metrics.latency.p99).toBeGreaterThan(0.3 + 3 * 0.15 - 1e-6);
  });
});
