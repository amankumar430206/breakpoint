/**
 * Erlang B and Erlang C — the two building blocks for multi-server queueing.
 *
 * Notation used throughout `queueing/`:
 *   λ  arrival rate (requests / sec)
 *   μ  per-server service rate (requests / sec) = 1 / meanServiceTime
 *   c  number of servers (concurrency slots / threads / pool connections)
 *   a  = λ / μ           offered load, in erlangs
 *   ρ  = a / c = λ/(cμ)  utilization per server (traffic intensity)
 *
 * References: Kleinrock, "Queueing Systems, Vol. 1" (1975); Harchol-Balter,
 * "Performance Modeling and Design of Computer Systems" (2013), ch. 14–15.
 */

/**
 * Erlang B — blocking probability of an M/M/c/c loss system (no queue).
 * Computed with the numerically stable recursion
 *   B(0, a) = 1
 *   B(k, a) = a·B(k-1, a) / (k + a·B(k-1, a))
 */
export function erlangB(c: number, a: number): number {
  if (c <= 0) return 1;
  if (a <= 0) return 0;
  let b = 1;
  for (let k = 1; k <= c; k++) {
    b = (a * b) / (k + a * b);
  }
  return b;
}

/**
 * Erlang C — probability that an arriving request has to wait (all c servers busy)
 * in an M/M/c queue. Requires ρ = a/c < 1; returns 1 at/above saturation.
 *
 * Derived from Erlang B:  C = c·B / (c − a·(1 − B))
 */
export function erlangC(c: number, a: number): number {
  if (c <= 0) return 1;
  if (a <= 0) return 0;
  if (a >= c) return 1;
  const b = erlangB(c, a);
  const denom = c - a * (1 - b);
  if (denom <= 0) return 1;
  return (c * b) / denom;
}
