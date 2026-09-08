import { describe, expect, it } from 'vitest';
import { parseDesign, parseDesignJson, serializeDesign } from './serialize';
import { designFromHash, designToHash } from './shareUrl';
import type { SystemDesign } from '@/engine';

const good: SystemDesign = {
  version: 1,
  name: 'Round trip',
  description: 'x',
  nodes: [
    { id: 'c', type: 'client', position: { x: 0, y: 0 }, params: {} },
    { id: 's', type: 'apiServer', position: { x: 0, y: 100 }, params: { replicas: 2 } },
  ],
  edges: [{ id: 'e', source: 'c', target: 's', params: { retries: 1 } }],
  sim: { scenario: { kind: 'constant', targetRps: 500, durationSec: 60 }, seed: 3, speed: 4 },
};

describe('serialize', () => {
  it('JSON round-trips a design unchanged', () => {
    const res = parseDesignJson(serializeDesign(good));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.design).toEqual(good);
  });

  it('rejects non-JSON', () => {
    expect(parseDesignJson('not json').ok).toBe(false);
  });

  it('rejects a bad shape', () => {
    expect(parseDesign({ nodes: 'nope' }).ok).toBe(false);
  });

  it('rejects duplicate node ids', () => {
    const dup = { ...good, nodes: [good.nodes[0], good.nodes[0]] };
    expect(parseDesign(dup).ok).toBe(false);
  });

  it('drops edges with unknown endpoints and warns', () => {
    const res = parseDesign({ ...good, edges: [...good.edges, { id: 'x', source: 'c', target: 'ghost', params: {} }] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.design.edges).toHaveLength(1);
      expect(res.warnings.length).toBeGreaterThan(0);
    }
  });

  it('fills defaults for a minimal design', () => {
    const res = parseDesign({
      nodes: [{ id: 'c', type: 'client', position: { x: 0, y: 0 } }],
      edges: [],
      sim: { scenario: { kind: 'ramp', targetRps: 10, durationSec: 30 } },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.design.name).toBe('Imported design');
      expect(res.design.sim.seed).toBe(1);
      expect(res.design.nodes[0].params).toEqual({});
    }
  });
});

describe('shareUrl', () => {
  it('compresses to a hash and back', () => {
    const hash = designToHash(good);
    expect(hash.startsWith('#d=')).toBe(true);
    const back = designFromHash(hash);
    expect(back).toEqual(good);
  });

  it('returns null for a missing or corrupt hash', () => {
    expect(designFromHash('')).toBeNull();
    expect(designFromHash('#d=@@@notvalid@@@')).toBeNull();
    expect(designFromHash('#other=1')).toBeNull();
  });
});
