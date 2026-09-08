import { describe, expect, it } from 'vitest';
import { analyze, hasModel, solve } from '@/engine';
import { PRESETS } from './index';

describe('preset library', () => {
  for (const { id, design } of PRESETS) {
    describe(id, () => {
      it('has a name, description and a client', () => {
        expect(design.name.length).toBeGreaterThan(0);
        expect(design.description?.length ?? 0).toBeGreaterThan(0);
        expect(design.nodes.some((n) => n.type === 'client')).toBe(true);
      });

      it('every node type is registered', () => {
        for (const n of design.nodes) expect(hasModel(n.type)).toBe(true);
      });

      it('every edge connects two real nodes', () => {
        const ids = new Set(design.nodes.map((n) => n.id));
        for (const e of design.edges) {
          expect(ids.has(e.source)).toBe(true);
          expect(ids.has(e.target)).toBe(true);
        }
      });

      it('node ids are unique', () => {
        const ids = design.nodes.map((n) => n.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('solves without an error-level warning and analyzes without throwing', () => {
        const r = solve(design);
        expect(r.warnings.filter((w) => w.level === 'error')).toHaveLength(0);
        expect(Number.isFinite(r.system.offeredRps)).toBe(true);
        expect(() => analyze(design, r)).not.toThrow();
      });

      it('has a finite system latency at 1/4 of its configured load', () => {
        const scaled = {
          ...design,
          sim: {
            ...design.sim,
            scenario: { ...design.sim.scenario, targetRps: design.sim.scenario.targetRps / 4 },
          },
        };
        const r = solve(scaled);
        expect(Number.isFinite(r.system.latency.p99)).toBe(true);
        expect(r.system.successRate).toBeGreaterThan(0.9);
      });
    });
  }
});
