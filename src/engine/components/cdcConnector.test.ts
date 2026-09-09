import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('cdcConnector');
const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'cdc', type: 'cdcConnector', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('cdcConnector', () => {
  it('forwards captureRatio of inflow as the change stream', () => {
    expect(m.outflowFraction({ captureRatio: 0.3 })).toBe(0.3);
    const r = solve({ captureRatio: 0.25, maxChangeRps: 100000 }, 8000);
    expect(r.metrics.throughput).toBeCloseTo(2000, 0);
    expect(r.metrics.rho).toBeCloseTo(2000 / 100000, 6);
  });

  it('adds the commit-to-topic lag as latency', () => {
    const r = solve({ lagMs: 800 }, 1000);
    expect(r.metrics.latency.mean).toBeCloseTo(0.8, 6);
  });

  it('falls behind when the change rate exceeds its ceiling', () => {
    const r = solve({ captureRatio: 0.5, maxChangeRps: 1000 }, 10000);
    expect(r.metrics.overloaded).toBe(true);
    expect(r.metrics.backlogGrowth).toBeGreaterThan(0);
  });

  it('is a branch node in the DES with branchProb = captureRatio', () => {
    expect(m.simSpec({ captureRatio: 0.4 }).branchProb).toBe(0.4);
    expect(m.simSpec({ lagMs: 500 }).fixedLatencySec).toBeCloseTo(0.5, 6);
  });
});
