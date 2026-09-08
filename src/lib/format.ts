/** Display formatting. The engine works in seconds / fractions / req·s⁻¹; this
 *  layer turns those into compact human strings. */

export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '∞';
  if (sec <= 0) return '0 ms';
  const ms = sec * 1000;
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms`;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 2 : 1)} s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

export function fmtRps(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 1000) return `${n < 10 ? n.toFixed(1) : n.toFixed(0)}/s`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k/s`;
  return `${(n / 1_000_000).toFixed(1)}M/s`;
}

export function fmtPct(frac: number, digits = 1): string {
  if (!Number.isFinite(frac)) return '∞';
  const p = frac * 100;
  if (p > 0 && p < 0.1) return '<0.1%';
  return `${p.toFixed(digits)}%`;
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (Math.abs(n) < 10) return n.toFixed(2);
  if (Math.abs(n) < 1000) return n.toFixed(0);
  return n.toLocaleString();
}

export type HealthLevel = 'idle' | 'ok' | 'warn' | 'hot' | 'crit';

/** Traffic-light level for a utilization value. */
export function healthForRho(rho: number, overloaded: boolean): HealthLevel {
  if (overloaded || rho >= 1) return 'crit';
  if (rho <= 0) return 'idle';
  if (rho < 0.6) return 'ok';
  if (rho < 0.8) return 'warn';
  return 'hot';
}

/** Health palette — vivid enough to read on both the dark and light grounds. */
export const HEALTH_COLOR: Record<HealthLevel, string> = {
  idle: '#94a3b8',
  ok: '#3fb950',
  warn: '#d29922',
  hot: '#f0883e',
  crit: '#f04434',
};
