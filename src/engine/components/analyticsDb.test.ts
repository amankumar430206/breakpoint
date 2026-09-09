import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('analyticsDb');
const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'dw', type: 'analyticsDb', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('analyticsDb', () => {
  it('is a sink whose ceiling is the slot count', () => {
    expect(m.routing).toBe('sink');
    expect(m.outflowFraction({})).toBe(0);
    // 8 slots / 3 s scan (no cache) ⇒ ~2.67 queries/s capacity
    const half = solve({ scanTimeSec: 3, concurrencySlots: 8, resultCacheHitRatio: 0 }, 1.3);
    const twice = solve({ scanTimeSec: 3, concurrencySlots: 16, resultCacheHitRatio: 0 }, 1.3);
    expect(half.metrics.rho).toBeGreaterThan(0.4);
    expect(twice.metrics.rho).toBeCloseTo(half.metrics.rho / 2, 2);
  });

  it('latency is measured in seconds, not milliseconds', () => {
    const r = solve({ scanTimeSec: 4, concurrencySlots: 8, resultCacheHitRatio: 0 }, 1);
    expect(r.metrics.latency.mean).toBeGreaterThan(1);
  });

  it('result cache offloads repeat queries — more hits, more headroom', () => {
    const cold = solve({ scanTimeSec: 3, concurrencySlots: 8, resultCacheHitRatio: 0 }, 2);
    const warm = solve({ scanTimeSec: 3, concurrencySlots: 8, resultCacheHitRatio: 0.7 }, 2);
    expect(warm.metrics.rho).toBeLessThan(cold.metrics.rho * 0.4);
  });

  it('queueOnFull off ⇒ excess fails fast instead of backing up', () => {
    const over = { scanTimeSec: 3, concurrencySlots: 4, resultCacheHitRatio: 0 } as const;
    const queued = solve({ ...over, queueOnFull: true, queueLimit: 200 }, 5);
    const loss = solve({ ...over, queueOnFull: false }, 5);
    // loss system: nothing waits, so more is shed and the queue stays empty
    expect(loss.metrics.dropRate).toBeGreaterThan(queued.metrics.dropRate);
    expect(loss.metrics.inQueue).toBeLessThan(queued.metrics.inQueue);
  });

  it('exposes a slot-count DES station', () => {
    const s = m.simSpec({ concurrencySlots: 12, scanTimeSec: 5, resultCacheHitRatio: 0, queueOnFull: false });
    expect(s.servers).toBe(12);
    expect(s.serviceRate).toBeCloseTo(1 / 5, 6);
    expect(s.queueCap).toBe(0);
  });
});
