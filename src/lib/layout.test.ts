import { describe, expect, it } from 'vitest';
import { autoLayout } from './layout';
import type { TmEdge, TmNode } from './design';

const node = (id: string): TmNode => ({
  id,
  type: 'apiServer',
  position: { x: Math.random() * 500, y: Math.random() * 500 },
  data: { label: id, params: {} },
});
const edge = (s: string, t: string): TmEdge => ({ id: `${s}-${t}`, source: s, target: t, data: { params: {} } });

describe('autoLayout', () => {
  it('stacks a linear chain by depth, top to bottom', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(node);
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')];
    const pos = autoLayout(nodes, edges);
    expect(pos.a.y).toBe(0);
    expect(pos.b.y).toBeGreaterThan(pos.a.y);
    expect(pos.c.y).toBeGreaterThan(pos.b.y);
    expect(pos.d.y).toBeGreaterThan(pos.c.y);
    // a single node per layer sits centred
    expect(pos.a.x).toBe(pos.d.x);
  });

  it('spreads siblings in the same layer horizontally', () => {
    const nodes = ['lb', 's1', 's2', 's3'].map(node);
    const edges = [edge('lb', 's1'), edge('lb', 's2'), edge('lb', 's3')];
    const pos = autoLayout(nodes, edges);
    expect(pos.s1.y).toBe(pos.s2.y);
    expect(pos.s2.y).toBe(pos.s3.y);
    const xs = [pos.s1.x, pos.s2.x, pos.s3.x].sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it('marches layers left-to-right when dir = LR', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(node);
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')];
    const pos = autoLayout(nodes, edges, 'LR');
    expect(pos.a.x).toBe(0);
    expect(pos.b.x).toBeGreaterThan(pos.a.x);
    expect(pos.c.x).toBeGreaterThan(pos.b.x);
    expect(pos.d.x).toBeGreaterThan(pos.c.x);
    // a single node per layer sits on the same cross-axis line
    expect(pos.a.y).toBe(pos.d.y);
  });

  it('spreads LR siblings vertically', () => {
    const nodes = ['lb', 's1', 's2', 's3'].map(node);
    const edges = [edge('lb', 's1'), edge('lb', 's2'), edge('lb', 's3')];
    const pos = autoLayout(nodes, edges, 'LR');
    expect(pos.s1.x).toBe(pos.s2.x);
    const ys = [pos.s1.y, pos.s2.y, pos.s3.y].sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });

  it('falls back to current positions on a cycle', () => {
    const nodes = ['a', 'b'].map(node);
    const before = { a: nodes[0].position, b: nodes[1].position };
    const pos = autoLayout(nodes, [edge('a', 'b'), edge('b', 'a')]);
    expect(pos.a).toEqual(before.a);
    expect(pos.b).toEqual(before.b);
  });
});
