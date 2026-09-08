import { describe, expect, it } from 'vitest';
import { Histogram } from './histogram';
import { mulberry32 } from '../rng';

describe('Histogram', () => {
  it('recovers quantiles of an exponential within bucket resolution', () => {
    const h = new Histogram();
    const rng = mulberry32(42);
    const rate = 5; // mean 0.2 s
    for (let i = 0; i < 200_000; i++) h.record(rng.exponential(rate));

    const exactP = (q: number) => -Math.log(1 - q) / rate;
    for (const q of [0.5, 0.9, 0.99]) {
      const got = h.quantile(q);
      const want = exactP(q);
      expect(Math.abs(got - want) / want).toBeLessThan(0.08);
    }
    expect(Math.abs(h.mean - 0.2) / 0.2).toBeLessThan(0.03);
  });

  it('is empty-safe and resettable', () => {
    const h = new Histogram();
    expect(h.quantile(0.5)).toBe(0);
    expect(h.mean).toBe(0);
    h.record(1);
    h.reset();
    expect(h.count).toBe(0);
  });

  it('merges two histograms additively', () => {
    const a = new Histogram();
    const b = new Histogram();
    a.record(0.1);
    a.record(0.1);
    b.record(0.1);
    a.merge(b);
    expect(a.count).toBe(3);
  });
});
