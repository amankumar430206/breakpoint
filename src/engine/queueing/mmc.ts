import { erlangC } from './erlang';
import type { QueueResult } from './types';

/**
 * M/M/c — c identical servers, Poisson arrivals, exponential service, unbounded queue.
 *
 *   a  = λ/μ            ρ = a/c
 *   Pw = C(c, a)        (Erlang C)
 *   Lq = Pw · ρ/(1−ρ)   Wq = Lq/λ = Pw/(cμ−λ)
 *   W  = Wq + 1/μ       L  = Lq + a
 *
 * Sojourn-time survival function (exact). With β = cμ − λ:
 *   P(T > t) = (1−Pw)·e^{−μt}  +  Pw · (μ·e^{−βt} − β·e^{−μt}) / (μ − β)
 * which reduces to the M/M/1 result e^{−(μ−λ)t} when c = 1. The β ≈ μ case
 * (degenerate: two equal exponential rates) uses the Erlang-2 limit.
 *
 * (Harchol-Balter 2013, §14.4–14.6.)
 */
export function mmc(lambda: number, mu: number, c: number): QueueResult {
  const servers = Math.max(1, Math.floor(c));
  const a = mu > 0 ? lambda / mu : Infinity;
  const rho = a / servers;

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
      throughput: Math.min(lambda, servers * mu),
    };
  }

  const pWait = erlangC(servers, a);
  const beta = servers * mu - lambda;
  const Lq = (pWait * rho) / (1 - rho);
  const Wq = Lq / lambda;
  const W = Wq + 1 / mu;
  const L = Lq + a;

  const survival = (t: number): number => {
    if (t <= 0) return 1;
    const eMu = Math.exp(-mu * t);
    const eBeta = Math.exp(-beta * t);
    let mixed: number;
    if (Math.abs(mu - beta) < 1e-9) {
      // rates coincide → Wq(cond) + S is Erlang-2(μ): (1 + μt) e^{−μt}
      mixed = (1 + mu * t) * eMu;
    } else {
      mixed = (mu * eBeta - beta * eMu) / (mu - beta);
    }
    return (1 - pWait) * eMu + pWait * mixed;
  };

  return {
    rho,
    stable: true,
    L,
    Lq,
    W,
    Wq,
    pWait,
    pBlock: 0,
    throughput: lambda,
    survival,
  };
}
