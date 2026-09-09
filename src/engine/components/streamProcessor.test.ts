import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('streamProcessor');
const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'sp', type: 'streamProcessor', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('streamProcessor', () => {
  it('passes records through', () => {
    expect(m.routing).toBe('passthrough');
    expect(m.outflowFraction({})).toBe(1);
  });

  it('parallelism is the throughput knob', () => {
    const base = { recordServiceMs: 4, stateBackend: 'heap', checkpointStallMs: 0 } as const;
    const p4 = solve({ ...base, parallelism: 4 }, 2000);
    const p8 = solve({ ...base, parallelism: 8 }, 2000);
    expect(p8.metrics.rho).toBeCloseTo(p4.metrics.rho / 2, 3);
  });

  it('checkpointing adds a small fixed latency to every record', () => {
    const none = solve({ recordServiceMs: 3, parallelism: 8, stateBackend: 'heap', checkpointStallMs: 0 }, 1000);
    const heavy = solve({ recordServiceMs: 3, parallelism: 8, stateBackend: 'heap', checkpointStallMs: 500, checkpointSec: 10 }, 1000);
    // 500 ms stall / 10 s ⇒ ~24 ms amortised
    expect(heavy.metrics.latency.mean - none.metrics.latency.mean).toBeGreaterThan(0.01);
  });

  it('RocksDB lookups cost more than heap as state grows', () => {
    const heap = solve({ recordServiceMs: 3, parallelism: 8, stateBackend: 'heap', stateGB: 40, checkpointStallMs: 0 }, 1000);
    const rocks = solve({ recordServiceMs: 3, parallelism: 8, stateBackend: 'rocksdb', stateGB: 40, checkpointStallMs: 0 }, 1000);
    expect(rocks.metrics.rho).toBeGreaterThan(heap.metrics.rho * 1.4);
  });

  it('warns about large heap state', () => {
    const r = solve({ stateBackend: 'heap', stateGB: 20, parallelism: 8 }, 500);
    expect(r.explain.some((e) => /heap state|GC|OOM|RocksDB/i.test(e.text))).toBe(true);
  });
});
