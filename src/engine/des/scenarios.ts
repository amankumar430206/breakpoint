import type { ScenarioConfig } from '../types';

/**
 * Instantaneous target arrival rate (req/s) at simulated time `t` (seconds).
 * All scenarios baseline at `targetRps` and peak at `targetRps · peakFactor`.
 */
export function arrivalRate(sc: ScenarioConfig, t: number): number {
  const base = Math.max(0, sc.targetRps);
  const peak = base * Math.max(1, sc.peakFactor ?? 1);
  const D = Math.max(1, sc.durationSec);
  const u = Math.min(1, Math.max(0, t / D)); // normalised progress

  switch (sc.kind) {
    case 'constant':
      return base;

    case 'ramp':
      return base + (peak - base) * u;

    case 'diurnal': {
      // one full sine cycle over the duration, trough = base, crest = peak
      const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
      return base + (peak - base) * s;
    }

    case 'spike': {
      // short burst centred at 45% of the run, ~8% of the duration wide
      const centre = 0.45;
      const half = 0.04;
      return u > centre - half && u < centre + half ? peak : base;
    }

    case 'thunderingHerd': {
      // quiet, then an instantaneous jump at 30% that decays back over ~25%
      const onset = 0.3;
      if (u < onset) return base;
      const decay = Math.exp(-(u - onset) / 0.12);
      return base + (peak - base) * decay;
    }

    default:
      return base;
  }
}

/** Upper bound on `arrivalRate` over the whole run — for Poisson thinning. */
export function maxArrivalRate(sc: ScenarioConfig): number {
  const base = Math.max(0, sc.targetRps);
  const peak = base * Math.max(1, sc.peakFactor ?? 1);
  return sc.kind === 'constant' ? base : Math.max(base, peak);
}
