import { mmc } from './mmc';
import type { QueueResult } from './types';

/**
 * M/M/c/K — c servers, system capacity K (in service + queued). Arrivals that find
 * K in the system are rejected (dropped / 503). Because rejection bounds the system,
 * a steady state exists even when ρ = λ/(cμ) ≥ 1.
 *
 * State probabilities (a = λ/μ, ρ = a/c):
 *   p_n = p_0 · a^n / n!                       0 ≤ n < c
 *   p_n = p_0 · (a^c / c!) · ρ^{n−c}           c ≤ n ≤ K
 *   p_0 = 1 / [ Σ_{n<c} a^n/n!  +  (a^c/c!)·Σ_{j=0}^{K−c} ρ^j ]
 *
 *   pBlock = p_K
 *   λ_eff  = λ·(1 − pBlock)
 *   L      = Σ n·p_n      Lq = Σ_{n≥c} (n−c)·p_n
 *   W      = L / λ_eff    Wq = Lq / λ_eff
 *
 * Mean metrics and blocking are exact. Percentiles use the M/M/c sojourn survival
 * evaluated at the effective (accepted) load λ_eff — a standard, documented
 * approximation; the result is flagged `approxPercentiles: true`.
 *
 * (Kleinrock 1975, §3.6; Gross & Harris, "Fundamentals of Queueing Theory", §2.5.)
 */
export function mmck(lambda: number, mu: number, c: number, K: number): QueueResult {
  const servers = Math.max(1, Math.floor(c));
  const cap = Math.max(servers, Math.floor(K));

  if (lambda <= 0 || mu <= 0) {
    return {
      rho: 0,
      stable: true,
      L: 0,
      Lq: 0,
      W: 0,
      Wq: 0,
      pWait: 0,
      pBlock: 0,
      throughput: 0,
    };
  }

  const a = lambda / mu;
  const rho = a / servers;

  // Unnormalised state weights via the ratio recurrence
  //   w_n / w_{n-1} = a/n  (n ≤ c)   or   ρ  (n > c)
  // which avoids the a^n and n! overflow of the closed form for large c. Rescale
  // on the fly so the running values never leave double range.
  const w: number[] = new Array(cap + 1);
  w[0] = 1;
  let total = 1;
  const BIG = 1e250;
  for (let n = 1; n <= cap; n++) {
    const ratio = n <= servers ? a / n : rho;
    w[n] = w[n - 1] * ratio;
    total += w[n];
    if (w[n] > BIG) {
      for (let k = 0; k <= n; k++) w[k] /= BIG;
      total /= BIG;
    }
  }
  const p = w.map((x) => x / total);

  const pBlock = p[cap];
  const lambdaEff = lambda * (1 - pBlock);

  let L = 0;
  let Lq = 0;
  let pWait = 0;
  for (let n = 0; n <= cap; n++) {
    L += n * p[n];
    if (n >= servers) {
      Lq += (n - servers) * p[n];
      if (n < cap) pWait += p[n]; // accepted arrival that finds all servers busy
    }
  }
  const W = lambdaEff > 0 ? L / lambdaEff : 0;
  const Wq = lambdaEff > 0 ? Lq / lambdaEff : 0;

  // Percentiles reuse the M/M/c sojourn survival at the accepted load. Clamp just
  // below cμ so the approximation stays finite under heavy overload — the mean
  // metrics above are exact and unaffected.
  const accepted = mmc(Math.min(lambdaEff, 0.999 * servers * mu), mu, servers);

  return {
    rho,
    stable: true,
    L,
    Lq,
    W,
    Wq,
    pWait,
    pBlock,
    throughput: lambdaEff,
    survival: accepted.survival,
    approxPercentiles: true,
  };
}
