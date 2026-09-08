import { describe, expect, it } from 'vitest';
import { solve } from './solver';
import type { EdgeSpec, NodeSpec, SystemDesign } from './types';

function node(id: string, type: NodeSpec['type'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, type, position: { x: 0, y: 0 }, label: id, params };
}
function edge(id: string, source: string, target: string, params: EdgeSpec['params'] = {}): EdgeSpec {
  return { id, source, target, params };
}
function design(nodes: NodeSpec[], edges: EdgeSpec[], targetRps: number): SystemDesign {
  return {
    version: 1,
    name: 'timeout',
    nodes,
    edges,
    sim: { scenario: { kind: 'constant', targetRps, durationSec: 60 }, seed: 1, speed: 1 },
  };
}

/** client → apiServer → sqlDatabase, DB lightly loaded so its sojourn ≈ Exp(queryTimeMs). */
function chain(edgeParams: EdgeSpec['params'], queryTimeMs = 40) {
  return design(
    [
      node('c', 'client'),
      node('s', 'apiServer', {
        serviceTimeMs: 0.5,
        concurrency: 128,
        replicas: 1,
        intrinsicErrorRate: 0,
      }),
      node('db', 'sqlDatabase', { queryTimeMs, poolSize: 64, intrinsicErrorRate: 0 }),
    ],
    [edge('e1', 'c', 's'), edge('e2', 's', 'db', edgeParams)],
    80,
  );
}

describe('per-attempt timeout — analytical', () => {
  it('is zero on an edge with no timeout set', () => {
    const r = solve(chain({}));
    expect(r.perEdge.e2.timeoutRate).toBe(0);
  });

  it('matches the M/M/1 sojourn tail e^(-timeout/mean)', () => {
    const r = solve(chain({ timeoutSec: 0.02 }, 40));
    const mean = r.perNode.db.metrics.latency.mean;
    expect(mean).toBeGreaterThan(0);
    const expected = Math.exp(-0.02 / mean);
    expect(r.perEdge.e2.timeoutRate).toBeCloseTo(expected, 4);
  });

  it('a tighter timeout clips more of the tail', () => {
    const loose = solve(chain({ timeoutSec: 0.2 })).perEdge.e2.timeoutRate;
    const tight = solve(chain({ timeoutSec: 0.02 })).perEdge.e2.timeoutRate;
    expect(tight).toBeGreaterThan(loose);
  });

  it('folds the timed-out fraction into end-to-end failure', () => {
    const noTimeout = solve(chain({})).system.successRate;
    const withTimeout = solve(chain({ timeoutSec: 0.02 })).system.successRate;
    expect(withTimeout).toBeLessThan(noTimeout - 0.1);
  });

  it('retries recover some timed-out attempts', () => {
    const bare = solve(chain({ timeoutSec: 0.02 })).system.successRate;
    const retried = solve(chain({ timeoutSec: 0.02, retries: 2 })).system.successRate;
    expect(retried).toBeGreaterThan(bare);
  });
});
