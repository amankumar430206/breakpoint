import { z } from 'zod';
import { clamp01 } from './util';
import type { BreakerState, ExplainNote, NodeMetrics } from '../types';
import { num, type ComponentModel } from './types';

/**
 * Circuit breaker (Hystrix / resilience4j style). Sits between a caller and a
 * flaky dependency. While the dependency's error rate over a rolling window
 * stays below `errorThresholdPct` the breaker is CLOSED and passes everything
 * through. Once it crosses the threshold the breaker trips OPEN: for
 * `cooldownSec` it fast-fails every call (no load reaches the dependency —
 * **the dependency is shielded**, and the caller gets a bounded fast-fail
 * latency instead of a timeout). After the cooldown it goes HALF-OPEN and lets
 * a probe through; success re-closes it, failure re-opens it.
 *
 * Analytical model: at steady state a persistently-failing dependency puts the
 * breaker on an OPEN↔probe duty cycle, OPEN a fraction
 *   pOpen ≈ cooldownSec / (cooldownSec + windowSec)
 * of the time. `outflowFraction = 1 − pOpen` (that is the shielding), and the
 * breaker's own latency/error is the blend of the fast-fail path (pOpen) and
 * the passthrough path (1 − pOpen).
 */

const RAMP = 0.2; // trip ramps over [thr·(1−RAMP), thr]

/**
 * Steady-state fraction of time the breaker is OPEN, given the wrapped
 * dependency's failure rate `f`.
 *
 * Once tripped, each cycle is: OPEN for `cooldownSec`, then a half-open probe.
 * The probe re-closes the breaker with probability `(1 − f)^halfOpenProbes`;
 * otherwise it re-opens immediately. A re-closed breaker observes for one
 * `windowSec` before the still-bad dependency trips it again. So:
 *   pOpen ≈ cooldownSec / (cooldownSec + pProbeOk · windowSec)
 * → approaches 1 as `f` → 1 (the dependency is fully shielded), and relaxes
 * toward `cooldownSec / (cooldownSec + windowSec)` as `f` nears the threshold.
 */
function openFraction(
  f: number,
  thr: number,
  windowSec: number,
  cooldownSec: number,
  halfOpenProbes: number,
): number {
  const lo = thr <= 0 ? 0 : thr * (1 - RAMP);
  const trip = thr <= 0 ? (f > 0 ? 1 : 0) : f <= lo ? 0 : f >= thr ? 1 : (f - lo) / (thr - lo);
  if (trip === 0) return 0;
  const pProbeOk = Math.pow(Math.max(0, 1 - f), Math.max(1, halfOpenProbes));
  return trip * (cooldownSec / (cooldownSec + pProbeOk * windowSec));
}

function stateFor(pOpen: number): BreakerState {
  if (pOpen >= 0.4) return 'open';
  if (pOpen > 0.02) return 'half-open';
  return 'closed';
}

export const circuitBreakerModel: ComponentModel = {
  type: 'circuitBreaker',
  label: 'Circuit Breaker',
  category: 'resilience',
  routing: 'passthrough',
  handles: { in: true, out: true },
  defaultParams: {
    errorThresholdPct: 50,
    windowSec: 10,
    cooldownSec: 30,
    halfOpenProbes: 1,
    fallbackErrorRate: 1,
    fastFailMs: 1,
  },
  paramSchema: z.object({
    errorThresholdPct: z.number().min(1).max(100).default(50),
    windowSec: z.number().positive().max(600).default(10),
    cooldownSec: z.number().positive().max(3600).default(30),
    halfOpenProbes: z.number().int().min(1).max(20).default(1),
    fallbackErrorRate: z.number().min(0).max(1).default(1),
    fastFailMs: z.number().nonnegative().max(1000).default(1),
  }),
  paramDocs: {
    errorThresholdPct: 'Downstream error rate (over the window) that trips the breaker OPEN.',
    windowSec: 'Rolling window the error rate is measured over.',
    cooldownSec: 'Time spent OPEN (fast-failing) before a half-open probe.',
    halfOpenProbes: 'Consecutive successful probes needed to re-close.',
    fallbackErrorRate: 'Error rate of the fast-fail response while OPEN (1 = always errors; <1 = a fallback/cache serves some).',
    fastFailMs: 'Latency of a fast-fail response — this is the bound on caller latency while OPEN.',
  },

  presetLegend: 'threshold % · cooldown s',
  presets: [
    { label: '50 · 30', hint: 'Balanced default', patch: { errorThresholdPct: 50, cooldownSec: 30 } },
    { label: '20 · 15', hint: 'Trip early, recover fast — latency-sensitive path', patch: { errorThresholdPct: 20, cooldownSec: 15, windowSec: 5 } },
    { label: '80 · 60', hint: 'Tolerate errors, back off hard once tripped', patch: { errorThresholdPct: 80, cooldownSec: 60 } },
  ],

  outflowFraction: (params, ctx) => {
    const f = clamp01(ctx?.downstreamFailure ?? 0);
    const pOpen = openFraction(
      f,
      num(params, 'errorThresholdPct', 50) / 100,
      num(params, 'windowSec', 10),
      num(params, 'cooldownSec', 30),
      num(params, 'halfOpenProbes', 1),
    );
    return 1 - pOpen;
  },

  simSpec: (params) => ({
    servers: Infinity,
    serviceRate: Infinity,
    queueCap: Infinity,
    fixedLatencySec: 0,
    errorRate: 0,
    branchProb: 1,
    breaker: {
      thresholdFrac: num(params, 'errorThresholdPct', 50) / 100,
      windowSec: num(params, 'windowSec', 10),
      cooldownSec: num(params, 'cooldownSec', 30),
      halfOpenProbes: Math.max(1, Math.round(num(params, 'halfOpenProbes', 1))),
      fallbackErrorRate: num(params, 'fallbackErrorRate', 1),
      fastFailSec: num(params, 'fastFailMs', 1) / 1000,
    },
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const thr = num(params, 'errorThresholdPct', 50) / 100;
    const windowSec = num(params, 'windowSec', 10);
    const cooldownSec = num(params, 'cooldownSec', 30);
    const fallback = num(params, 'fallbackErrorRate', 1);
    const fastFailSec = num(params, 'fastFailMs', 1) / 1000;

    const f = clamp01(downstreamErrorRate);
    const halfOpenProbes = num(params, 'halfOpenProbes', 1);
    const pOpen = openFraction(f, thr, windowSec, cooldownSec, halfOpenProbes);
    const state = stateFor(pOpen);

    // Caller sees: fast-fail (pOpen) blended with passthrough exposure to the
    // dependency's own failure (1 − pOpen).
    const errorRate = clamp01(pOpen * fallback + (1 - pOpen) * f);
    // Latency the breaker itself contributes: the OPEN fraction is capped at the
    // fast-fail time; the CLOSED fraction adds nothing of its own.
    const selfLat = pOpen * fastFailSec;

    const metrics: NodeMetrics = {
      arrivalRate: inflow,
      throughput: inflow * (1 - errorRate),
      rho: 0,
      servers: 1,
      inSystem: 0,
      inQueue: 0,
      latency: { mean: selfLat, p50: selfLat, p95: selfLat, p99: selfLat },
      dropRate: 0,
      errorRate,
      stable: true,
      overloaded: false,
      backlogGrowth: 0,
      breakerState: state,
    };

    const explain: ExplainNote[] = [];
    if (state === 'closed') {
      explain.push({
        metric: 'errorRate',
        text: `Dependency error rate ${(f * 100).toFixed(1)}% is below the ${(thr * 100).toFixed(0)}% trip threshold — breaker CLOSED, everything passes through.`,
      });
    } else {
      explain.push({
        metric: 'errorRate',
        text: `Dependency failing at ${(f * 100).toFixed(1)}% (≥ ${(thr * 100).toFixed(0)}%) — breaker ${state.toUpperCase()} ~${(pOpen * 100).toFixed(0)}% of the time. That fraction never reaches the dependency (load capped) and the caller fast-fails in ${(fastFailSec * 1000).toFixed(0)} ms instead of waiting for a timeout.`,
        formula: 'pOpen ≈ cooldownSec / (cooldownSec + windowSec)',
        dominantTerm: 'breaker OPEN duty cycle',
      });
    }
    return { metrics, explain };
  },
};
