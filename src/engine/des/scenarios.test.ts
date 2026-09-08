import { describe, expect, it } from 'vitest';
import { arrivalRate, maxArrivalRate } from './scenarios';
import type { ScenarioConfig } from '../types';

const sc = (over: Partial<ScenarioConfig>): ScenarioConfig => ({
  kind: 'constant',
  targetRps: 100,
  durationSec: 100,
  peakFactor: 5,
  ...over,
});

describe('scenarios', () => {
  it('constant is flat and its own max', () => {
    const c = sc({ kind: 'constant' });
    expect(arrivalRate(c, 0)).toBe(100);
    expect(arrivalRate(c, 50)).toBe(100);
    expect(maxArrivalRate(c)).toBe(100);
  });

  it('ramp goes baseline → peak linearly', () => {
    const c = sc({ kind: 'ramp' });
    expect(arrivalRate(c, 0)).toBeCloseTo(100, 6);
    expect(arrivalRate(c, 50)).toBeCloseTo(300, 6);
    expect(arrivalRate(c, 100)).toBeCloseTo(500, 6);
  });

  it('diurnal troughs at baseline and crests at peak', () => {
    const c = sc({ kind: 'diurnal' });
    expect(arrivalRate(c, 0)).toBeCloseTo(100, 4);
    expect(arrivalRate(c, 50)).toBeCloseTo(500, 4);
    expect(arrivalRate(c, 100)).toBeCloseTo(100, 4);
  });

  it('spike is baseline except for a short burst near 45%', () => {
    const c = sc({ kind: 'spike' });
    expect(arrivalRate(c, 10)).toBe(100);
    expect(arrivalRate(c, 45)).toBe(500);
    expect(arrivalRate(c, 90)).toBe(100);
  });

  it('thundering herd jumps at 30% then decays toward baseline', () => {
    const c = sc({ kind: 'thunderingHerd' });
    expect(arrivalRate(c, 10)).toBe(100);
    expect(arrivalRate(c, 30)).toBeCloseTo(500, 4);
    expect(arrivalRate(c, 80)).toBeLessThan(150);
  });

  it('all non-constant scenarios expose peak as their max', () => {
    for (const kind of ['ramp', 'diurnal', 'spike', 'thunderingHerd'] as const) {
      expect(maxArrivalRate(sc({ kind }))).toBe(500);
    }
  });
});
