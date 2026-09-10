/// <reference lib="webworker" />
/**
 * Live Probe load generator. Runs entirely off the main thread so the canvas
 * and charts stay smooth and `performance.now()` timing is less contended.
 *
 * Fires real `fetch()` at ONE developer-owned endpoint, at a controlled rate
 * (open loop) or with a fixed virtual-user pool (closed loop), times each
 * request, classifies the outcome, and streams ~2 Hz windowed samples plus a
 * final summary. Hard caps + an allow-list are re-checked here — never trust the
 * UI alone.
 */
import { ProbeAggregator, classifyStatus, type Outcome } from './aggregate';
import {
  clampConfig,
  isAllowedTarget,
  MAX_TOTAL_REQUESTS,
  projectedRequestCount,
  type ProbeConfig,
} from './targetPolicy';
import {
  PROBE_SAMPLE_MS,
  type FromProbe,
  type ProbeResult,
  type ProbeTarget,
  type ToProbe,
} from './probeProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromProbe) => ctx.postMessage(m);

const MAX_IN_FLIGHT = 1000;

let running = false;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
/** Set by the active run so `stop` can end it with a final summary. */
let endRun: ((stoppedEarly: boolean) => void) | null = null;
const inflight = new Set<AbortController>();

function abortAll() {
  for (const c of inflight) c.abort();
  inflight.clear();
}

function stopTimers() {
  if (sampleTimer != null) {
    clearInterval(sampleTimer);
    sampleTimer = null;
  }
}

interface OneResult {
  latencyMs: number;
  outcome: Outcome;
  retryAfterMs: number;
}

async function fireOnce(target: ProbeTarget, timeoutMs: number): Promise<OneResult> {
  const ctrl = new AbortController();
  inflight.add(ctrl);
  const to = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const started = performance.now();
  try {
    const headers: Record<string, string> = {};
    for (const [k, v] of target.headers) if (k.trim()) headers[k.trim()] = v;
    const init: RequestInit = {
      method: target.method,
      headers,
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal,
    };
    if (target.method !== 'GET' && target.body) init.body = target.body;

    const res = await fetch(target.url, init);
    const latencyMs = performance.now() - started;

    // redirect:'manual' surfaces a cross-origin 3xx as an opaque response — we
    // never follow it (could leave the allow-listed host).
    if (res.type === 'opaqueredirect') {
      return { latencyMs, outcome: 'net-error', retryAfterMs: 0 };
    }
    const outcome = classifyStatus(res.status);
    let retryAfterMs = 0;
    if (outcome === 'throttled' || res.status === 503) {
      const ra = res.headers.get('retry-after');
      const secs = ra ? Number(ra) : NaN;
      retryAfterMs = Number.isFinite(secs) ? Math.min(30_000, Math.max(0, secs * 1000)) : 1000;
    }
    return { latencyMs, outcome, retryAfterMs };
  } catch (err) {
    const latencyMs = performance.now() - started;
    const isTimeout =
      err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { latencyMs, outcome: isTimeout ? 'timeout' : 'net-error', retryAfterMs: 0 };
  } finally {
    clearTimeout(to);
    inflight.delete(ctrl);
  }
}

function run(nodeId: string, target: ProbeTarget, raw: ProbeConfig) {
  const config = clampConfig(raw);

  const check = isAllowedTarget(target.url);
  if (!check.ok) {
    post({ type: 'error', message: check.reason ?? 'Target not allowed.' });
    return;
  }
  if (projectedRequestCount(config) > MAX_TOTAL_REQUESTS) {
    post({
      type: 'error',
      message: `That configuration could issue over ${MAX_TOTAL_REQUESTS.toLocaleString()} requests. Lower the rate or duration.`,
    });
    return;
  }

  running = true;
  const agg = new ProbeAggregator();
  const startedAt = performance.now();
  let lastSampleAt = startedAt;
  let backoffUntil = 0;

  const elapsedSec = () => (performance.now() - startedAt) / 1000;

  const record = (r: OneResult) => {
    agg.push(r.latencyMs, r.outcome);
    if (r.retryAfterMs > 0) backoffUntil = Math.max(backoffUntil, performance.now() + r.retryAfterMs);
  };

  const finish = (stoppedEarly: boolean) => {
    if (!running) return;
    running = false;
    endRun = null;
    stopTimers();
    abortAll();
    const s = agg.summary(elapsedSec());
    const result: ProbeResult = { ...s, nodeId, target: target.url, mode: config.mode, stoppedEarly };
    post({ type: 'done', result });
  };
  endRun = finish;

  sampleTimer = setInterval(() => {
    if (!running) return;
    const now = performance.now();
    const winSec = (now - lastSampleAt) / 1000;
    lastSampleAt = now;
    const w = agg.drainWindow(winSec);
    post({
      type: 'sample',
      point: { ...w, t: elapsedSec(), targetRps: config.mode === 'rps' ? config.targetRps : NaN },
    });
    if (elapsedSec() >= config.durationSec) finish(false);
  }, PROBE_SAMPLE_MS);

  if (config.mode === 'rps') {
    // Open loop: exponential inter-arrivals (Poisson) at the target rate.
    const tick = () => {
      if (!running) return;
      if (elapsedSec() >= config.durationSec) {
        finish(false);
        return;
      }
      const now = performance.now();
      if (now >= backoffUntil && inflight.size < MAX_IN_FLIGHT) {
        agg.markStart();
        void fireOnce(target, config.timeoutMs).then(record);
      }
      const meanGap = 1000 / config.targetRps;
      const gap = -Math.log(1 - Math.random()) * meanGap;
      setTimeout(tick, Math.max(0, gap));
    };
    tick();
  } else {
    // Closed loop: N users, each fetch → think → repeat.
    const user = async () => {
      while (running && elapsedSec() < config.durationSec) {
        if (performance.now() < backoffUntil) {
          await sleep(backoffUntil - performance.now());
          continue;
        }
        agg.markStart();
        record(await fireOnce(target, config.timeoutMs));
        if (config.thinkTimeSec > 0 && running) {
          await sleep(-Math.log(1 - Math.random()) * config.thinkTimeSec * 1000);
        }
      }
      if (elapsedSec() >= config.durationSec) finish(false);
    };
    for (let i = 0; i < config.users; i++) void user();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

ctx.onmessage = (e: MessageEvent<ToProbe>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    // Discard a run already in progress without emitting its summary.
    if (running) {
      running = false;
      endRun = null;
      stopTimers();
      abortAll();
    }
    run(msg.nodeId, msg.target, msg.config);
  } else if (msg.type === 'stop') {
    // End the current run early but still deliver a final summary.
    endRun?.(true);
  }
};
