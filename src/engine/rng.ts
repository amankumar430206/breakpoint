/**
 * Deterministic, seedable PRNG + sampling helpers for the discrete-event simulator.
 *
 * mulberry32 — tiny, fast, good enough statistical quality for queueing simulation.
 * Same seed ⇒ identical stream ⇒ reproducible runs (a hard requirement for the
 * DES↔analytical convergence tests).
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Exponential with the given rate (mean = 1 / rate). */
  exponential(rate: number): number;
  /** Number of Poisson(mean) events — Knuth's algorithm. */
  poisson(mean: number): number;
  /** Fork a child stream (seeded from the parent) for independent sub-streams. */
  fork(): Rng;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;

  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const exponential = (rate: number): number => {
    if (rate <= 0) return Infinity;
    // Inverse-CDF; guard against log(0).
    let u = next();
    if (u <= 0) u = Number.MIN_VALUE;
    return -Math.log(u) / rate;
  };

  const poisson = (mean: number): number => {
    if (mean <= 0) return 0;
    if (mean > 500) {
      // Normal approximation to avoid the product underflowing / looping forever.
      return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian(next, next)));
    }
    const l = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= next();
    } while (p > l);
    return k - 1;
  };

  const fork = (): Rng => mulberry32((next() * 4294967296) >>> 0);

  return { next, exponential, poisson, fork };
}

/** Box–Muller standard normal from two uniforms. */
function gaussian(u1: () => number, u2: () => number): number {
  let a = u1();
  if (a <= 0) a = Number.MIN_VALUE;
  const b = u2();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}
