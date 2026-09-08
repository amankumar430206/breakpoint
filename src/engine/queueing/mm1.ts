import type { QueueResult } from './types';

/**
 * M/M/1 — single server, Poisson arrivals, exponential service, unbounded queue.
 *
 *   ρ  = λ/μ
 *   L  = ρ/(1−ρ)              Lq = ρ²/(1−ρ)
 *   W  = 1/(μ−λ)             Wq = ρ/(μ−λ)
 *   Sojourn time T ~ Exponential(μ−λ)  ⇒  P(T > t) = e^{−(μ−λ)t}
 *   ⇒ exact quantile:  t_q = −ln(1−q) / (μ−λ)
 *
 * (Kleinrock 1975, §3.2 / §5.6.)
 */
export function mm1(lambda: number, mu: number): QueueResult {
  const rho = mu > 0 ? lambda / mu : Infinity;

  if (!(rho < 1) || lambda <= 0 || mu <= 0) {
    return {
      rho,
      stable: false,
      L: Infinity,
      Lq: Infinity,
      W: Infinity,
      Wq: Infinity,
      pWait: 1,
      pBlock: 0,
      throughput: Math.min(lambda, mu),
    };
  }

  const beta = mu - lambda; // sojourn-time rate
  const L = rho / (1 - rho);
  const Lq = (rho * rho) / (1 - rho);
  const W = 1 / beta;
  const Wq = rho / beta;

  return {
    rho,
    stable: true,
    L,
    Lq,
    W,
    Wq,
    pWait: rho, // P(server busy) = ρ
    pBlock: 0,
    throughput: lambda,
    survival: (t: number) => (t <= 0 ? 1 : Math.exp(-beta * t)),
  };
}
