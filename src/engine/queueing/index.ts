export { erlangB, erlangC } from './erlang';
export { mm1 } from './mm1';
export { mmc } from './mmc';
export { mmck } from './mmck';
export { quantileFromSurvival, DEFAULT_QUANTILES } from './percentiles';
export type { QueueResult } from './types';

import type { QueueResult } from './types';
import { quantileFromSurvival } from './percentiles';

/** Convenience: pull a {p50, p95, p99} map (seconds) off a QueueResult. */
export function percentiles(
  r: QueueResult,
  quantiles: readonly number[] = [0.5, 0.95, 0.99],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of quantiles) {
    const key = `p${Math.round(q * 100)}`;
    if (!r.stable || !r.survival) {
      out[key] = Infinity;
    } else {
      out[key] = quantileFromSurvival(r.survival, q);
    }
  }
  return out;
}
