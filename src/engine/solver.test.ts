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
    name: 't',
    nodes,
    edges,
    sim: { scenario: { kind: 'constant', targetRps, durationSec: 60 }, seed: 1, speed: 1 },
  };
}

describe('solve — healthy chain', () => {
  const d = design(
    [
      node('c', 'client'),
      node('s', 'apiServer', { serviceTimeMs: 40, concurrency: 16, replicas: 2 }),
      node('db', 'sqlDatabase', { queryTimeMs: 8, poolSize: 20 }),
    ],
    [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
    100,
  );
  const r = solve(d);

  it('converges and is healthy', () => {
    expect(r.converged).toBe(true);
    expect(r.system.healthy).toBe(true);
    expect(r.warnings.filter((w) => w.level === 'error')).toHaveLength(0);
  });

  it('routes the full offered load through server and db', () => {
    expect(r.perNode.s.metrics.arrivalRate).toBeCloseTo(100, 6);
    expect(r.perNode.db.metrics.arrivalRate).toBeCloseTo(100, 6);
  });

  it('server ρ = λ/(c·replicas·μ) = 100 / 800 = 0.125', () => {
    expect(r.perNode.s.metrics.rho).toBeCloseTo(0.125, 6);
  });

  it('end-to-end p99 exceeds the raw service-time sum but is finite', () => {
    expect(r.system.latency.p99).toBeGreaterThan(0.048); // 40ms + 8ms
    expect(Number.isFinite(r.system.latency.p99)).toBe(true);
  });

  it('success rate is high but dented by intrinsic error rates', () => {
    expect(r.system.successRate).toBeGreaterThan(0.99);
    expect(r.system.successRate).toBeLessThan(1);
  });
});

describe('solve — removing the load balancer overloads the single server', () => {
  const r = solve(
    design(
      [
        node('c', 'client'),
        node('s', 'apiServer', { serviceTimeMs: 40, concurrency: 4, replicas: 1 }),
        node('db', 'sqlDatabase'),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
      300, // capacity is 4 · 25 = 100 rps
    ),
  );

  it('marks the server overloaded and sheds most of the traffic', () => {
    expect(r.perNode.s.metrics.overloaded).toBe(true);
    expect(r.perNode.s.metrics.rho).toBeGreaterThan(1);
    expect(r.perNode.s.metrics.dropRate).toBeGreaterThan(0.5);
  });

  it('reports the system as unhealthy with an excess-load figure', () => {
    expect(r.system.healthy).toBe(false);
    expect(r.perNode.s.metrics.backlogGrowth).toBeGreaterThan(0);
  });

  it('with load shedding OFF, latency is unbounded instead of dropping', () => {
    const unbounded = solve(
      design(
        [
          node('c', 'client'),
          node('s', 'apiServer', {
            serviceTimeMs: 40,
            concurrency: 4,
            replicas: 1,
            loadShedding: false,
          }),
          node('db', 'sqlDatabase'),
        ],
        [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
        300,
      ),
    );
    expect(unbounded.perNode.s.metrics.latency.p99).toBe(Infinity);
    expect(unbounded.system.latency.p99).toBe(Infinity);
    expect(unbounded.perNode.s.metrics.dropRate).toBe(0);
  });
});

describe('solve — the cache protects the database', () => {
  const withCache = solve(
    design(
      [
        node('c', 'client'),
        node('k', 'cache', { hitRatio: 0.9 }),
        node('db', 'sqlDatabase', { queryTimeMs: 10, poolSize: 10 }),
      ],
      [edge('e1', 'c', 'k'), edge('e2', 'k', 'db')],
      5000,
    ),
  );
  const noCache = solve(
    design(
      [
        node('c', 'client'),
        node('k', 'cache', { hitRatio: 0 }),
        node('db', 'sqlDatabase', { queryTimeMs: 10, poolSize: 10 }),
      ],
      [edge('e1', 'c', 'k'), edge('e2', 'k', 'db')],
      5000,
    ),
  );

  it('a 90% hit ratio cuts DB arrival rate 10×', () => {
    expect(withCache.perNode.db.metrics.arrivalRate).toBeCloseTo(500, 3);
    expect(noCache.perNode.db.metrics.arrivalRate).toBeCloseTo(5000, 3);
  });

  it('DB is fine with the cache and melts without it', () => {
    expect(withCache.perNode.db.metrics.overloaded).toBe(false);
    expect(noCache.perNode.db.metrics.overloaded).toBe(true);
  });
});

describe('solve — scaling out recovers latency', () => {
  const mk = (replicas: number) =>
    solve(
      design(
        [
          node('c', 'client'),
          node('s', 'apiServer', {
            serviceTimeMs: 20,
            concurrency: 8,
            replicas,
            loadShedding: false,
          }),
          node('db', 'sqlDatabase'),
        ],
        [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
        700, // one replica: capacity 8·50 = 400 rps → saturated
      ),
    );

  it('p99 drops monotonically as replicas are added', () => {
    const p1 = mk(1).perNode.s.metrics.latency.p99;
    const p2 = mk(2).perNode.s.metrics.latency.p99;
    const p3 = mk(3).perNode.s.metrics.latency.p99;
    expect(p1).toBe(Infinity);
    expect(p3).toBeLessThan(p2);
    expect(Number.isFinite(p3)).toBe(true);
  });
});

describe('solve — degenerate graphs', () => {
  it('reports a cycle as an error', () => {
    const r = solve(
      design(
        [node('a', 'apiServer'), node('b', 'apiServer')],
        [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
        10,
      ),
    );
    expect(r.warnings.some((w) => w.level === 'error')).toBe(true);
    expect(r.converged).toBe(false);
  });

  it('ignores unknown component types with a warning', () => {
    const r = solve(
      design([node('c', 'client'), { ...node('x', 'client'), type: 'quantum' as never }], [], 10),
    );
    expect(r.warnings.some((w) => w.message.includes('Unknown component'))).toBe(true);
  });
});
