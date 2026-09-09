import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('coordination');
const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'zk', type: 'coordination', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('coordination', () => {
  it('is a sink', () => {
    expect(m.routing).toBe('sink');
    expect(m.outflowFraction({})).toBe(0);
  });

  it('a bigger ensemble slows writes but not reads', () => {
    const writeHeavy = { readRatio: 0.2, opLatencyMs: 2, writeQuorumMs: 5, poolSize: 64 } as const;
    const n3 = solve({ ...writeHeavy, ensembleSize: 3 }, 4000);
    const n7 = solve({ ...writeHeavy, ensembleSize: 7 }, 4000);
    expect(n7.metrics.rho).toBeGreaterThan(n3.metrics.rho);

    const readOnly = { readRatio: 1, opLatencyMs: 2, poolSize: 64 } as const;
    const r3 = solve({ ...readOnly, ensembleSize: 3 }, 4000);
    const r7 = solve({ ...readOnly, ensembleSize: 7 }, 4000);
    expect(r7.metrics.rho).toBeCloseTo(r3.metrics.rho, 6);
  });

  it('write-heavy churn saturates before a read-heavy load does', () => {
    const base = { ensembleSize: 5, opLatencyMs: 2, writeQuorumMs: 6, poolSize: 16 } as const;
    const reads = solve({ ...base, readRatio: 0.95 }, 3000);
    const writes = solve({ ...base, readRatio: 0.2 }, 3000);
    expect(reads.metrics.overloaded).toBe(false);
    expect(writes.metrics.overloaded).toBe(true);
  });

  it('linearizable reads pay the quorum round-trip too', () => {
    const serial = solve({ readRatio: 1, opLatencyMs: 2, writeQuorumMs: 6, linearizableReads: false }, 100);
    const linear = solve({ readRatio: 1, opLatencyMs: 2, writeQuorumMs: 6, linearizableReads: true }, 100);
    expect(linear.metrics.latency.mean).toBeGreaterThan(serial.metrics.latency.mean * 2);
  });

  it('warns about high watch fan-out', () => {
    const r = solve({ watchClients: 200000, readRatio: 0.5, ensembleSize: 3 }, 200);
    expect(r.explain.some((e) => /watch|fan-?out|notif/i.test(e.text))).toBe(true);
  });
});
