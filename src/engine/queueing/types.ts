/** Shared shape returned by every queueing model in `queueing/`. Times are in seconds. */
export interface QueueResult {
  /** Utilization per server, ρ = λ/(cμ). Can exceed 1 for unstable open models. */
  rho: number;
  /** Whether a steady state exists (ρ < 1, or blocking keeps a finite system finite). */
  stable: boolean;
  /** Mean number of requests in the system (queue + in service). */
  L: number;
  /** Mean number of requests waiting in the queue. */
  Lq: number;
  /** Mean sojourn time (wait + service). */
  W: number;
  /** Mean time spent waiting in the queue. */
  Wq: number;
  /** Probability an arriving request must wait (Erlang C), where meaningful. */
  pWait: number;
  /** Fraction of offered requests rejected (bounded models only; 0 otherwise). */
  pBlock: number;
  /** Effective throughput actually served (λ·(1−pBlock)). */
  throughput: number;
  /** Sojourn-time survival function P(T > t), t in seconds. Undefined when unstable. */
  survival?: (t: number) => number;
  /** True when percentiles come from a documented approximation rather than a closed form. */
  approxPercentiles?: boolean;
}
