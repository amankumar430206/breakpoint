import { describe, expect, it } from 'vitest';
import { analyze, hasModel, solve } from '@/engine';
import { randomDesign } from './randomDesign';
import { parseDesign } from './serialize';

describe('randomDesign', () => {
  it('is reproducible for a given seed', () => {
    expect(randomDesign(42)).toEqual(randomDesign(42));
    expect(randomDesign(1)).not.toEqual(randomDesign(2));
  });

  it('produces a valid, solvable design across many seeds', () => {
    for (let seed = 0; seed < 60; seed++) {
      const d = randomDesign(seed);

      // structural
      expect(d.nodes.some((n) => n.type === 'client')).toBe(true);
      for (const n of d.nodes) expect(hasModel(n.type)).toBe(true);
      const ids = new Set(d.nodes.map((n) => n.id));
      expect(ids.size).toBe(d.nodes.length);
      for (const e of d.edges) {
        expect(ids.has(e.source)).toBe(true);
        expect(ids.has(e.target)).toBe(true);
      }

      // passes the import validator unchanged
      const parsed = parseDesign(d);
      expect(parsed.ok).toBe(true);

      // solves + analyzes without throwing
      const r = solve(d);
      expect(r.warnings.filter((w) => w.level === 'error')).toHaveLength(0);
      expect(Number.isFinite(r.system.offeredRps)).toBe(true);
      expect(() => analyze(d, r)).not.toThrow();
    }
  });

  it('names carry the seed and the scenario is well-formed', () => {
    const d = randomDesign(7);
    expect(d.name).toMatch(/#\d+$/);
    expect(d.sim.scenario.durationSec).toBeGreaterThan(0);
    expect(['rps', 'users']).toContain(d.sim.scenario.mode);
  });
});
