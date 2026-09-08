/**
 * Generic numeric quantile from a survival function S(t) = P(T > t).
 *
 * S must be continuous and monotonically non-increasing on [0, ∞) with S(0) = 1
 * and S(∞) = 0 — true for every sojourn-time distribution we use. We bracket the
 * root of S(t) = 1 − q by doubling, then bisect. Robust and dependency-free.
 */
export function quantileFromSurvival(
  survival: (t: number) => number,
  q: number,
  opts: { maxT?: number; tol?: number; iterations?: number } = {},
): number {
  if (q <= 0) return 0;
  if (q >= 1) return Infinity;

  const target = 1 - q; // want S(t) === target
  const tol = opts.tol ?? 1e-9;
  const iterations = opts.iterations ?? 200;
  const cap = opts.maxT ?? 1e12;

  // Bracket: grow hi until S(hi) <= target.
  let lo = 0;
  let hi = 1e-6;
  while (survival(hi) > target) {
    hi *= 2;
    if (hi > cap) return Infinity;
  }

  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const s = survival(mid);
    if (Math.abs(s - target) < tol) return mid;
    if (s > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Standard percentile set we surface on every node. */
export const DEFAULT_QUANTILES = [0.5, 0.95, 0.99] as const;
