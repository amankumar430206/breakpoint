import { describe, expect, it } from 'vitest';
import { mm1 } from './mm1';
import { mmc } from './mmc';
import { quantileFromSurvival } from './percentiles';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('mmc', () => {
  it('λ=3, μ=2, c=2 → textbook Pw=9/14, Lq=1.928571, Wq=0.642857, W=1.142857, L=3.428571', () => {
    const r = mmc(3, 2, 2);
    expect(r.stable).toBe(true);
    expect(close(r.rho, 0.75)).toBe(true);
    expect(close(r.pWait, 9 / 14, 1e-12)).toBe(true);
    expect(close(r.Lq, 1.9285714285714286, 1e-10)).toBe(true);
    expect(close(r.Wq, 0.6428571428571429, 1e-10)).toBe(true);
    expect(close(r.W, 1.1428571428571428, 1e-10)).toBe(true);
    expect(close(r.L, 3.4285714285714284, 1e-10)).toBe(true);
  });

  it("Little's Law holds", () => {
    const r = mmc(3, 2, 2);
    expect(close(r.L, 3 * r.W, 1e-9)).toBe(true);
    expect(close(r.Lq, 3 * r.Wq, 1e-9)).toBe(true);
  });

  it('c=1 reduces exactly to M/M/1 (metrics + sojourn survival)', () => {
    const a = mmc(8, 10, 1);
    const b = mm1(8, 10);
    expect(close(a.L, b.L)).toBe(true);
    expect(close(a.Wq, b.Wq)).toBe(true);
    for (const t of [0.01, 0.1, 0.5, 1, 3]) {
      expect(close(a.survival!(t), b.survival!(t), 1e-9)).toBe(true);
    }
  });

  it('sojourn survival is a valid CDF: S(0)=1, decreasing, → 0', () => {
    const r = mmc(3, 2, 2);
    expect(close(r.survival!(0), 1)).toBe(true);
    expect(r.survival!(1)).toBeGreaterThan(r.survival!(2));
    expect(r.survival!(1e6)).toBeLessThan(1e-6);
  });

  it('p99 ≥ p95 ≥ p50 and all finite when stable', () => {
    const r = mmc(3, 2, 2);
    const p50 = quantileFromSurvival(r.survival!, 0.5);
    const p95 = quantileFromSurvival(r.survival!, 0.95);
    const p99 = quantileFromSurvival(r.survival!, 0.99);
    expect(p50).toBeLessThan(p95);
    expect(p95).toBeLessThan(p99);
    expect(Number.isFinite(p99)).toBe(true);
  });

  it('adding servers cuts the wait: Wq(c=3) < Wq(c=2) for the same load', () => {
    expect(mmc(3, 2, 3).Wq).toBeLessThan(mmc(3, 2, 2).Wq);
  });

  it('is unstable when λ ≥ cμ', () => {
    expect(mmc(4, 2, 2).stable).toBe(false);
  });
});
