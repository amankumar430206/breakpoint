import { describe, expect, it } from 'vitest';
import { buildGraph, computeFlow, expectedAttempts, topoOrder } from './flow';
import { getModel } from './registry';
import type { EdgeSpec, NodeSpec } from './types';

function node(id: string, type: NodeSpec['type'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, type, position: { x: 0, y: 0 }, params };
}
function edge(id: string, source: string, target: string, params: EdgeSpec['params'] = {}): EdgeSpec {
  return { id, source, target, params };
}

function runFlow(nodes: NodeSpec[], edges: EdgeSpec[], entryRate: number, fail: Record<string, number> = {}) {
  const g = buildGraph(nodes, edges);
  const order = topoOrder(g)!;
  return computeFlow({
    g,
    order,
    entryRate,
    outflowFraction: (id) => getModel(g.byId.get(id)!.type).outflowFraction(g.byId.get(id)!.params),
    routingMode: (id) => getModel(g.byId.get(id)!.type).routing,
    attemptFailure: (e) => fail[e.target] ?? 0,
  });
}

describe('expectedAttempts', () => {
  it('is 1 with no retries', () => {
    expect(expectedAttempts(0.5, 0)).toBe(1);
  });
  it('is 1 when the dependency never fails', () => {
    expect(expectedAttempts(0, 3)).toBe(1);
  });
  it('matches the truncated geometric sum Σ q^k', () => {
    // p=0.2, R=2 → 1 + 0.2 + 0.04 = 1.24
    expect(expectedAttempts(0.2, 2)).toBeCloseTo(1.24, 10);
  });
});

describe('topoOrder', () => {
  it('returns an order for a DAG', () => {
    const g = buildGraph([node('a', 'client'), node('b', 'apiServer')], [edge('e', 'a', 'b')]);
    expect(topoOrder(g)).toEqual(['a', 'b']);
  });
  it('returns null on a cycle', () => {
    const g = buildGraph(
      [node('a', 'apiServer'), node('b', 'apiServer')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
    );
    expect(topoOrder(g)).toBeNull();
  });
});

describe('computeFlow', () => {
  it('passes traffic straight down a chain', () => {
    const f = runFlow(
      [node('c', 'client'), node('s', 'apiServer'), node('d', 'sqlDatabase')],
      [edge('e1', 'c', 's'), edge('e2', 's', 'd')],
      100,
    );
    expect(f.nodeInflow.get('s')).toBeCloseTo(100, 9);
    expect(f.nodeInflow.get('d')).toBeCloseTo(100, 9);
  });

  it('splits evenly across load-balanced backends', () => {
    const f = runFlow(
      [node('c', 'client'), node('lb', 'loadBalancer'), node('a', 'apiServer'), node('b', 'apiServer')],
      [edge('e0', 'c', 'lb'), edge('e1', 'lb', 'a'), edge('e2', 'lb', 'b')],
      200,
    );
    expect(f.nodeInflow.get('a')).toBeCloseTo(100, 9);
    expect(f.nodeInflow.get('b')).toBeCloseTo(100, 9);
  });

  it('honours edge weights', () => {
    const f = runFlow(
      [node('c', 'client'), node('lb', 'loadBalancer'), node('a', 'apiServer'), node('b', 'apiServer')],
      [edge('e0', 'c', 'lb'), edge('e1', 'lb', 'a', { weight: 3 }), edge('e2', 'lb', 'b', { weight: 1 })],
      200,
    );
    expect(f.nodeInflow.get('a')).toBeCloseTo(150, 9);
    expect(f.nodeInflow.get('b')).toBeCloseTo(50, 9);
  });

  it('only the cache-miss fraction reaches the origin', () => {
    const f = runFlow(
      [node('c', 'client'), node('k', 'cache', { hitRatio: 0.9 }), node('d', 'sqlDatabase')],
      [edge('e1', 'c', 'k'), edge('e2', 'k', 'd')],
      1000,
    );
    expect(f.nodeInflow.get('k')).toBeCloseTo(1000, 9);
    expect(f.nodeInflow.get('d')).toBeCloseTo(100, 9);
  });

  it('amplifies edge flow when the target is failing and retries are set', () => {
    const f = runFlow(
      [node('c', 'client'), node('s', 'apiServer'), node('d', 'sqlDatabase')],
      [edge('e1', 'c', 's'), edge('e2', 's', 'd', { retries: 2 })],
      100,
      { d: 0.3 },
    );
    // attempts = 1 + 0.3 + 0.09 = 1.39
    expect(f.edgeFlow.get('e2')).toBeCloseTo(139, 6);
    expect(f.nodeInflow.get('d')).toBeCloseTo(139, 6);
    expect(f.edgeRetryFactor.get('e2')).toBeCloseTo(1.39, 6);
  });
});
