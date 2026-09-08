import { describe, expect, it } from 'vitest';
import { mmck } from './mmck';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

/** Closed-form M/M/1/K blocking probability for cross-checking. */
function mm1kBlock(rho: number, K: number): number {
  if (close(rho, 1)) return 1 / (K + 1);
  return ((1 - rho) * Math.pow(rho, K)) / (1 - Math.pow(rho, K + 1));
}

describe('mmck', () => {
  it('M/M/1/2 with ρ=1 → uniform states, pBlock = 1/3', () => {
    const r = mmck(1, 1, 1, 2);
    expect(close(r.pBlock, 1 / 3, 1e-12)).toBe(true);
    expect(close(r.L, 1, 1e-12)).toBe(true);
    expect(close(r.Lq, 1 / 3, 1e-12)).toBe(true);
    expect(close(r.throughput, 2 / 3, 1e-12)).toBe(true);
    expect(close(r.W, 1.5, 1e-12)).toBe(true);
    expect(close(r.Wq, 0.5, 1e-12)).toBe(true);
  });

  it('M/M/1/K blocking matches the closed form across ρ and K', () => {
    for (const [lam, mu, K] of [
      [1, 2, 3],
      [3, 2, 5],
      [9, 10, 10],
      [5, 5, 4],
    ] as const) {
      const r = mmck(lam, mu, 1, K);
      expect(close(r.pBlock, mm1kBlock(lam / mu, K), 1e-10)).toBe(true);
    }
  });

  it('stays stable (finite) even when λ > cμ, because arrivals are dropped', () => {
    const r = mmck(50, 10, 2, 8);
    expect(r.stable).toBe(true);
    expect(Number.isFinite(r.W)).toBe(true);
    expect(r.pBlock).toBeGreaterThan(0.5);
    expect(r.throughput).toBeLessThanOrEqual(2 * 10 + 1e-9);
  });

  it('throughput = λ·(1 − pBlock) and flags percentiles as approximate', () => {
    const r = mmck(12, 4, 2, 6);
    expect(close(r.throughput, 12 * (1 - r.pBlock), 1e-10)).toBe(true);
    expect(r.approxPercentiles).toBe(true);
  });

  it('larger K lowers blocking', () => {
    expect(mmck(12, 4, 2, 10).pBlock).toBeLessThan(mmck(12, 4, 2, 4).pBlock);
  });

  it('stays finite for a large server count (no a^n / n! overflow)', () => {
    // c = 192, a = λ/μ = 84 — the closed form overflows here; the ratio
    // recurrence must not.
    const r = mmck(14000, 166.7, 192, 392);
    for (const v of [r.rho, r.L, r.Lq, r.W, r.Wq, r.pBlock, r.throughput]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(r.rho).toBeCloseTo(14000 / (192 * 166.7), 4);
    expect(r.pBlock).toBeLessThan(0.01); // ρ ≈ 0.44 — plenty of headroom
  });

  it('matches the closed form for a moderate server count', () => {
    // M/M/5/10, λ=4, μ=1  → cross-check L against direct summation of the
    // closed-form weights a^n/n! and a^c/c!·ρ^{n-c}.
    const c = 5;
    const K = 10;
    const a = 4;
    const rho = a / c;
    const w: number[] = [1];
    let fact = 1;
    for (let n = 1; n <= K; n++) {
      if (n <= c) {
        fact *= n;
        w[n] = a ** n / fact;
      } else {
        w[n] = w[n - 1] * rho;
      }
    }
    const tot = w.reduce((s, x) => s + x, 0);
    let L = 0;
    for (let n = 0; n <= K; n++) L += (n * w[n]) / tot;

    expect(mmck(4, 1, 5, 10).L).toBeCloseTo(L, 9);
  });
});
