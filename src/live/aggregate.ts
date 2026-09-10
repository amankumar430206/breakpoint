/**
 * Latency / outcome aggregation for the Live Probe. Pure — no timers, no fetch.
 * The worker feeds every completed request in here; the store reads windowed
 * samples (~2 Hz) for the charts and one final summary for the results row.
 */

export type Outcome = 'ok' | 'net-error' | 'http-4xx' | 'http-5xx' | 'timeout' | 'throttled';

export const OUTCOMES: Outcome[] = ['ok', 'net-error', 'http-4xx', 'http-5xx', 'timeout', 'throttled'];

const zeroClasses = (): Record<Outcome, number> =>
  ({ ok: 0, 'net-error': 0, 'http-4xx': 0, 'http-5xx': 0, timeout: 0, throttled: 0 });

/** Map an HTTP status to an outcome bucket. 2xx/3xx = ok, 429 = throttled. */
export function classifyStatus(status: number): Outcome {
  if (status === 429) return 'throttled';
  if (status >= 500) return 'http-5xx';
  if (status >= 400) return 'http-4xx';
  return 'ok';
}

/** Linear-interpolated quantile of an ascending-sorted array. */
export function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const idx = q * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface WindowStats {
  /** Requests completed in this window. */
  count: number;
  /** count / windowSec. */
  achievedRps: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  /** non-ok / count. */
  errorRate: number;
  /** Currently outstanding (started, not yet completed). */
  inFlight: number;
  byClass: Record<Outcome, number>;
}

export interface ProbeSummary {
  totalRequests: number;
  ok: number;
  errors: number;
  errorRate: number;
  achievedRps: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  byClass: Record<Outcome, number>;
  durationSec: number;
}

/**
 * Accumulates one probe run. `push` records a completed request; `drainWindow`
 * returns + resets the per-window slice (in-flight carries forward); `summary`
 * returns run totals without resetting.
 */
export class ProbeAggregator {
  private winLat: number[] = [];
  private winCls = zeroClasses();
  private winCompleted = 0;

  private allLat: number[] = [];
  private allCls = zeroClasses();
  private started = 0;
  private completed = 0;

  markStart(): void {
    this.started++;
  }

  push(latencyMs: number, outcome: Outcome): void {
    const v = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;
    this.winLat.push(v);
    this.allLat.push(v);
    this.winCls[outcome]++;
    this.allCls[outcome]++;
    this.winCompleted++;
    this.completed++;
  }

  get inFlight(): number {
    return Math.max(0, this.started - this.completed);
  }

  get totalCompleted(): number {
    return this.completed;
  }

  drainWindow(windowSec: number): WindowStats {
    const sorted = this.winLat.slice().sort((a, b) => a - b);
    const count = this.winCompleted;
    const errors = count - this.winCls.ok;
    const stats: WindowStats = {
      count,
      achievedRps: windowSec > 0 ? count / windowSec : 0,
      p50: quantileSorted(sorted, 0.5),
      p90: quantileSorted(sorted, 0.9),
      p99: quantileSorted(sorted, 0.99),
      max: sorted.length ? sorted[sorted.length - 1] : 0,
      errorRate: count > 0 ? errors / count : 0,
      inFlight: this.inFlight,
      byClass: { ...this.winCls },
    };
    this.winLat = [];
    this.winCls = zeroClasses();
    this.winCompleted = 0;
    return stats;
  }

  summary(durationSec: number): ProbeSummary {
    const sorted = this.allLat.slice().sort((a, b) => a - b);
    const total = this.completed;
    const errors = total - this.allCls.ok;
    return {
      totalRequests: total,
      ok: this.allCls.ok,
      errors,
      errorRate: total > 0 ? errors / total : 0,
      achievedRps: durationSec > 0 ? total / durationSec : 0,
      p50: quantileSorted(sorted, 0.5),
      p90: quantileSorted(sorted, 0.9),
      p99: quantileSorted(sorted, 0.99),
      max: sorted.length ? sorted[sorted.length - 1] : 0,
      byClass: { ...this.allCls },
      durationSec,
    };
  }
}
