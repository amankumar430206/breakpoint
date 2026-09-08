import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('circuitBreaker');

const solve = (params: Record<string, unknown>, inflow: number, downstreamErrorRate: number) =>
  m.solve({
    node: { id: 'cb', type: 'circuitBreaker', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate,
  });

const outflow = (params: Record<string, unknown>, downstreamFailure: number) =>
  m.outflowFraction({ ...m.defaultParams, ...params }, { downstreamFailure });

describe('circuitBreaker', () => {
  it('stays CLOSED and passes everything through below the threshold', () => {
    const r = solve({ errorThresholdPct: 50 }, 1000, 0.2);
    expect(r.metrics.breakerState).toBe('closed');
    expect(outflow({ errorThresholdPct: 50 }, 0.2)).toBeCloseTo(1, 6);
    // caller only sees the dependency's own 20% failure, no fast-fail on top
    expect(r.metrics.errorRate).toBeCloseTo(0.2, 6);
    expect(r.metrics.latency.p99).toBeCloseTo(0, 6);
  });

  it('trips OPEN above the threshold and shields the dependency', () => {
    const p = { errorThresholdPct: 50, windowSec: 10, cooldownSec: 30 };
    const r = solve(p, 1000, 0.8);
    expect(r.metrics.breakerState).toBe('open');
    // f = 0.8 → pProbeOk = 0.2, pOpen = 30/(30 + 0.2·10) = 0.9375 → ~6% passes through
    expect(outflow(p, 0.8)).toBeCloseTo(0.0625, 3);
  });

  it('bounds caller latency to the fast-fail time while OPEN', () => {
    // dependency fully down → breaker OPEN ~100% → self-latency ≈ fastFailMs
    const r = solve({ errorThresholdPct: 50, fastFailMs: 4, windowSec: 10, cooldownSec: 30 }, 500, 1);
    expect(r.metrics.latency.p99).toBeCloseTo(0.004, 4);
  });

  it('a longer cooldown shields harder once tripped', () => {
    const short = outflow({ errorThresholdPct: 50, windowSec: 10, cooldownSec: 10 }, 0.7);
    const long = outflow({ errorThresholdPct: 50, windowSec: 10, cooldownSec: 90 }, 0.7);
    expect(long).toBeLessThan(short);
    // outflow = 1 − pOpen, pOpen = cooldown / (cooldown + 0.3·window)
    expect(short).toBeCloseTo(3 / 13, 2);
    expect(long).toBeCloseTo(3 / 93, 2);
  });

  it('ramps between half-open and open through the trip band', () => {
    const thr = 0.5;
    const below = solve({ errorThresholdPct: thr * 100 }, 100, thr * 0.75);
    const mid = solve({ errorThresholdPct: thr * 100 }, 100, thr * 0.88);
    const over = solve({ errorThresholdPct: thr * 100 }, 100, thr * 1.1);
    expect(below.metrics.breakerState).toBe('closed');
    expect(mid.metrics.breakerState).toBe('half-open');
    expect(over.metrics.breakerState).toBe('open');
  });

  it('exposes params through the registry-driven form', () => {
    expect(m.category).toBe('resilience');
    expect(m.routing).toBe('passthrough');
    expect(Object.keys(m.paramDocs)).toContain('cooldownSec');
  });
});
