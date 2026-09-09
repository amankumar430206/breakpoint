import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';
import { solve } from '../solver';
import type { EdgeSpec, NodeSpec, SystemDesign } from '../types';

const m = getModel('dbProxy');

function node(id: string, type: NodeSpec['type'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, type, position: { x: 0, y: 0 }, label: id, params };
}
function edge(id: string, source: string, target: string): EdgeSpec {
  return { id, source, target, params: {} };
}
function design(nodes: NodeSpec[], edges: EdgeSpec[], targetRps: number): SystemDesign {
  return {
    version: 1,
    name: 'dbproxy',
    nodes,
    edges,
    sim: { scenario: { kind: 'constant', targetRps, durationSec: 60 }, seed: 1, speed: 1 },
  };
}

const ctx = (params: Record<string, unknown>, inflow: number) => ({
  node: node('p', 'dbProxy', params),
  params: { ...m.defaultParams, ...params },
  inflow,
  downstreamErrorRate: 0,
});

describe('dbProxy', () => {
  it('caps forwarded rate at backend capacity (backendConns / holdTime)', () => {
    // 25 conns · (1000/5 ms) = 5000 req/s ceiling
    expect(m.outflowFraction({ ...m.defaultParams, backendConns: 25, avgHoldMs: 5, poolMode: 'transaction' }, { inflow: 20000 })).toBeCloseTo(
      0.25,
      2,
    );
    expect(m.outflowFraction({ ...m.defaultParams, backendConns: 25, avgHoldMs: 5 }, { inflow: 3000 })).toBe(1);
  });

  it('session pooling multiplexes worse than transaction pooling', () => {
    const txn = m.solve(ctx({ backendConns: 20, avgHoldMs: 4, poolMode: 'transaction' }, 4000));
    const session = m.solve(ctx({ backendConns: 20, avgHoldMs: 4, poolMode: 'session' }, 4000));
    expect(session.metrics.rho).toBeGreaterThan(txn.metrics.rho * 2);
  });

  it('shields a pool-bound database — the DB sees at most backendConns concurrent', () => {
    const withProxy = design(
      [
        node('c', 'client'),
        node('api', 'apiServer', { serviceTimeMs: 1, concurrency: 256, replicas: 1 }),
        node('p', 'dbProxy', { backendConns: 30, avgHoldMs: 5, queueDepth: 2000 }),
        node('db', 'sqlDatabase', { architecture: 'single', queryTimeMs: 5, poolSize: 30 }),
      ],
      [edge('e1', 'c', 'api'), edge('e2', 'api', 'p'), edge('e3', 'p', 'db')],
      12000,
    );
    const noProxy = design(
      [
        node('c', 'client'),
        node('api', 'apiServer', { serviceTimeMs: 1, concurrency: 256, replicas: 1 }),
        node('db', 'sqlDatabase', { architecture: 'single', queryTimeMs: 5, poolSize: 30 }),
      ],
      [edge('e1', 'c', 'api'), edge('e2', 'api', 'db')],
      12000,
    );
    const dbWith = solve(withProxy).perNode.db.metrics.arrivalRate;
    const dbWithout = solve(noProxy).perNode.db.metrics.arrivalRate;
    expect(dbWith).toBeLessThan(dbWithout);
  });

  it('reports connection exhaustion when pool + wait queue fill', () => {
    const r = m.solve(ctx({ backendConns: 5, avgHoldMs: 10, queueDepth: 5 }, 5000));
    expect(r.metrics.dropRate).toBeGreaterThan(0.3);
    expect(r.explain[1].text).toMatch(/too many connections/i);
  });
});
