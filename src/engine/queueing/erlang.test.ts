import { describe, expect, it } from 'vitest';
import { erlangB, erlangC } from './erlang';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('erlangB', () => {
  it('B(1, a) = a / (1 + a)', () => {
    expect(close(erlangB(1, 0.5), 0.5 / 1.5)).toBe(true);
    expect(close(erlangB(1, 2), 2 / 3)).toBe(true);
  });

  it('B(2, 1) = 1/5 (textbook)', () => {
    expect(close(erlangB(2, 1), 0.2)).toBe(true);
  });

  it('B(2, 1.5) ≈ 0.3103448', () => {
    expect(close(erlangB(2, 1.5), 0.31034482758620685, 1e-12)).toBe(true);
  });

  it('is 0 at zero load and 1 with zero servers', () => {
    expect(erlangB(3, 0)).toBe(0);
    expect(erlangB(0, 5)).toBe(1);
  });
});

describe('erlangC', () => {
  it('C(2, 1) = 1/3 (classic)', () => {
    expect(close(erlangC(2, 1), 1 / 3)).toBe(true);
  });

  it('C(2, 1.5) = 9/14', () => {
    expect(close(erlangC(2, 1.5), 9 / 14, 1e-12)).toBe(true);
  });

  it('C(1, a) = a  (reduces to M/M/1 P(wait) = ρ)', () => {
    expect(close(erlangC(1, 0.8), 0.8)).toBe(true);
  });

  it('saturates to 1 when a >= c', () => {
    expect(erlangC(2, 2)).toBe(1);
    expect(erlangC(3, 5)).toBe(1);
  });
});
