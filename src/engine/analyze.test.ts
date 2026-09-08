import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { solve } from './solver';
import type { EdgeSpec, NodeSpec, SystemDesign } from './types';

function node(id: string, type: NodeSpec['type'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, type, position: { x: 0, y: 0 }, label: id, params };
}
function edge(id: string, s: string, t: string, params: EdgeSpec['params'] = {}): EdgeSpec {
  return { id, source: s, target: t, params };
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

describe('analyze', () => {
  it('reports a healthy system with no bottlenecks or fixes', () => {
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', { serviceTimeMs: 10, vcpus: 8, ramGB: 16, replicas: 2 }),
        node('db', 'sqlDatabase', { queryTimeMs: 2, poolSize: 80 }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
      200,
    );
    const a = analyze(d, solve(d));
    expect(a.healthy).toBe(true);
    expect(a.bottlenecks).toHaveLength(0);
    expect(a.fixes).toHaveLength(0);
  });

  it('names the saturated node and finds a fix that clears it', () => {
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', { serviceTimeMs: 20, vcpus: 1, parallelPerVcpu: 4, replicas: 1 }),
        node('db', 'sqlDatabase', { queryTimeMs: 1, poolSize: 200 }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
      600, // capacity ~ 4 · 50 = 200 rps
    );
    const a = analyze(d, solve(d));
    expect(a.healthy).toBe(false);
    expect(a.bottlenecks[0].nodeId).toBe('s');
    expect(a.bottlenecks[0].severity).toBe('critical');
    expect(a.fixes.length).toBeGreaterThan(0);

    const clearing = a.fixes.find((f) => f.clears);
    expect(clearing).toBeDefined();
    // applying the top fix really does make the system healthy
    const patched = {
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === a.fixes[0].nodeId ? { ...n, params: { ...n.params, ...a.fixes[0].patch } } : n,
      ),
    };
    expect(solve(patched).system.successRate).toBeGreaterThan(a.fixes[0].projectedSuccess - 1e-6);
  });

  it('fixes are ranked cheapest-clearing first', () => {
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', { serviceTimeMs: 15, vcpus: 2, parallelPerVcpu: 4, replicas: 1 }),
        node('db', 'sqlDatabase', { queryTimeMs: 1, poolSize: 200 }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
      500,
    );
    const a = analyze(d, solve(d));
    const clearing = a.fixes.filter((f) => f.clears);
    for (let i = 1; i < clearing.length; i++) {
      expect(clearing[i].cost).toBeGreaterThanOrEqual(clearing[i - 1].cost);
    }
  });

  it('suggests raising an upstream cache hit ratio when the DB is the bottleneck', () => {
    const d = design(
      [
        node('c', 'client'),
        node('k', 'cache', { hitRatio: 0.5, capacityRps: 200000 }),
        node('db', 'sqlDatabase', { queryTimeMs: 8, poolSize: 6 }),
      ],
      [edge('e1', 'c', 'k'), edge('e2', 'k', 'db')],
      3000, // ~1500 rps reaches the DB; capacity ~750 — well over
    );
    const a = analyze(d, solve(d));
    expect(a.bottlenecks.some((b) => b.nodeId === 'db')).toBe(true);
    expect(a.fixes.some((f) => f.nodeId === 'k' && 'hitRatio' in f.patch)).toBe(true);
  });
});
