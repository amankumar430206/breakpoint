import { describe, expect, it } from 'vitest';
import { mm1 } from './mm1';
import { quantileFromSurvival } from './percentiles';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('mm1', () => {
  it('λ=8, μ=10 → textbook ρ=0.8, L=4, Lq=3.2, W=0.5, Wq=0.4', () => {
    const r = mm1(8, 10);
    expect(r.stable).toBe(true);
    expect(close(r.rho, 0.8)).toBe(true);
    expect(close(r.L, 4)).toBe(true);
    expect(close(r.Lq, 3.2)).toBe(true);
    expect(close(r.W, 0.5)).toBe(true);
    expect(close(r.Wq, 0.4)).toBe(true);
    expect(close(r.pWait, 0.8)).toBe(true);
  });

  it("Little's Law holds: L = λ·W", () => {
    const r = mm1(8, 10);
    expect(close(r.L, 8 * r.W)).toBe(true);
    expect(close(r.Lq, 8 * r.Wq)).toBe(true);
  });

  it('sojourn percentiles match −ln(1−q)/(μ−λ)', () => {
    const r = mm1(8, 10);
    const beta = 2; // μ − λ
    for (const q of [0.5, 0.95, 0.99]) {
      const exact = -Math.log(1 - q) / beta;
      expect(close(quantileFromSurvival(r.survival!, q), exact, 1e-6)).toBe(true);
    }
  });

  it('is unstable at ρ ≥ 1', () => {
    expect(mm1(10, 10).stable).toBe(false);
    expect(mm1(12, 10).stable).toBe(false);
    expect(mm1(12, 10).W).toBe(Infinity);
  });
});
