/**
 * Live Probe target gate. The probe is a real load generator (real `fetch()`,
 * not simulation), so we classify every target:
 *
 *  - loopback / `*.local` / `*.localhost` / RFC1918 / IPv6 ULA  → allowed, private
 *  - anything else that parses as http(s)                       → allowed, PUBLIC
 *    (the UI requires a one-time "I have permission" acknowledgement per host,
 *     and most public APIs still fail on CORS from a browser)
 *  - link-local `169.254/16` (covers the cloud metadata endpoint), `0.0.0.0`,
 *    and non-http(s) schemes                                    → always refused
 *
 * The classification is re-checked in three places: the URL field, the "Test"
 * button, and the worker's `start` handler — never trust just one.
 */

/** Hard ceilings. UI clamps to these; the worker self-aborts if a run exceeds them. */
export const MAX_RPS = 500;
export const MAX_USERS = 200;
export const MAX_DURATION_SEC = 180;
export const MAX_TOTAL_REQUESTS = 30_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 60_000;

export interface TargetCheck {
  ok: boolean;
  /** Why it was refused (shown inline under the URL field). */
  reason?: string;
  /** true for a host that isn't loopback / private — needs a permission ack and
   *  will usually be blocked by the browser's CORS policy. */
  isPublic?: boolean;
  /** HTTPS page → `http://` target: the browser may block it. Not fatal. */
  mixedContentWarning?: boolean;
  /** Parsed URL, present only when `ok`. */
  url?: URL;
}

const PRIVATE_V4: RegExp[] = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 172.16.0.0/12
];

/** Loopback, private-network, or an explicitly local hostname suffix.
 *  Link-local (169.254/16, fe80::/10) is deliberately NOT allowed — that range
 *  includes the cloud metadata endpoint. */
export function isLoopbackOrPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h === 'ip6-localhost') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local')) return true;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    return PRIVATE_V4.some((re) => re.test(h));
  }
  if (h.includes(':')) {
    // IPv6 loopback, or Unique Local Address fc00::/7 (fc.. / fd..).
    return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h);
  }
  return false;
}

/** Hosts that are never a legitimate probe target. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === '0.0.0.0' || h === '::') return true;
  if (/^169\.254\./.test(h)) return true; // link-local — includes the cloud metadata IP
  if (/^fe80:/.test(h)) return true; // IPv6 link-local
  return false;
}

export function isAllowedTarget(raw: string): TargetCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'Enter a full URL, e.g. http://localhost:3000/health' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http:// and https:// targets are supported.' };
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, reason: 'That address is not allowed as a probe target.' };
  }
  const onHttps =
    typeof location !== 'undefined' && location != null && location.protocol === 'https:';
  const mixedContentWarning = onHttps && url.protocol === 'http:';

  if (isLoopbackOrPrivateHost(url.hostname)) {
    return { ok: true, url, isPublic: false, mixedContentWarning };
  }
  return { ok: true, url, isPublic: true, mixedContentWarning };
}

export type ProbeMode = 'rps' | 'users';

export interface ProbeConfig {
  mode: ProbeMode;
  targetRps: number;
  users: number;
  thinkTimeSec: number;
  durationSec: number;
  timeoutMs: number;
}

export const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  mode: 'rps',
  targetRps: 50,
  users: 10,
  thinkTimeSec: 0.5,
  durationSec: 30,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/** Clamp a config to the hard ceilings. Used by the UI and re-checked in the worker. */
export function clampConfig(c: ProbeConfig): ProbeConfig {
  return {
    mode: c.mode === 'users' ? 'users' : 'rps',
    targetRps: Math.round(clamp(c.targetRps, 1, MAX_RPS)),
    users: Math.round(clamp(c.users, 1, MAX_USERS)),
    thinkTimeSec: clamp(c.thinkTimeSec, 0, 60),
    durationSec: Math.round(clamp(c.durationSec, 1, MAX_DURATION_SEC)),
    timeoutMs: Math.round(clamp(c.timeoutMs, 100, MAX_TIMEOUT_MS)),
  };
}

/** Upper bound on how many requests a config could issue — the worker aborts past this. */
export function projectedRequestCount(c: ProbeConfig): number {
  if (c.mode === 'rps') return c.targetRps * c.durationSec;
  // closed loop: at best one request per (0 service + thinkTime) per user
  const perUserPerSec = 1 / Math.max(0.02, c.thinkTimeSec);
  return Math.ceil(c.users * perUserPerSec * c.durationSec);
}
