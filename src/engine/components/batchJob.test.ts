import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';
import { solve } from '../solver';
import type { EdgeSpec, NodeSpec, SystemDesign } from '../types';

const m = getModel('batchJob');

function node(id: string, type: NodeSpec['type'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, type, position: { x: 0, y: 0 }, label: id, params };
}
function design(nodes: NodeSpec[], edges: EdgeSpec[]): SystemDesign {
  return {
    version: 1,
    name: 'batch',
    nodes,
    edges,
    sim: { scenario: { kind: 'constant', targetRps: 0, durationSec: 60 }, seed: 1, speed: 1 },
  };
}

describe('batchJob', () => {
  it('selfLoad is the average record rate', () => {
    expect(m.selfLoad!({ recordsPerRun: 360000, intervalSec: 3600 })).toBeCloseTo(100, 6);
  });

  it('injects its average rate into the downstream store', () => {
    const mk = (intervalSec: number, recordsPerRun: number) =>
      design(
        [
          node('job', 'batchJob', { intervalSec, recordsPerRun, recordServiceMs: 3, parallelism: 8 }),
          node('db', 'sqlDatabase', { architecture: 'single', queryTimeMs: 1, poolSize: 200 }),
        ],
        [{ id: 'e1', source: 'job', target: 'db', params: {} }],
      );

    const slow = solve(mk(3600, 360_000)); // 100 rec/s
    const fast = solve(mk(600, 360_000)); // 600 rec/s
    const more = solve(mk(3600, 3_600_000)); // 1000 rec/s

    expect(slow.perNode.db.metrics.arrivalRate).toBeCloseTo(100, 0);
    expect(fast.perNode.db.metrics.arrivalRate).toBeCloseTo(600, 0);
    expect(more.perNode.db.metrics.arrivalRate).toBeCloseTo(1000, 0);
  });

  it('reports the duty-cycle utilisation and warns about burst rate', () => {
    const r = m.solve({
      node: node('job', 'batchJob', {}),
      params: { ...m.defaultParams, recordsPerRun: 100000, intervalSec: 3600, recordServiceMs: 5, parallelism: 4 },
      inflow: 100000 / 3600,
      downstreamErrorRate: 0,
    });
    expect(r.metrics.rho).toBeLessThan(1);
    expect(r.explain.some((e) => /burst|understates|steady-state/i.test(e.text))).toBe(true);
  });
});
