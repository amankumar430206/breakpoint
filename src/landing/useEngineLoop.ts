import { useEffect, useMemo, useRef, useState } from 'react';
import { solve, type SystemDesign } from '@/engine';

export interface LoopFrame {
  /** monotonic seconds since mount — x-axis for the charts */
  t: number;
  offered: number;
  served: number;
  p99ms: number;
  success: number;
  rho: Record<string, number>;
  over: Record<string, boolean>;
  /** short headline: what the scripted scenario is doing right now */
  phase: string;
}

export interface SeriesPoint {
  t: number;
  offered: number;
  served: number;
  p99ms: number;
}

const LOOP_SECONDS = 46; // one full calm → busy → spike → recover cycle
const SIM_STEP = 0.5; // simulated seconds advanced per tick
const TICK_MS = 130; // wall-clock cadence  (≈ loop plays in ~12 s)
const MAX_POINTS = 260;

const LO = 1600;
const HI = 4600;
const SPIKE = 10500;

/** Piecewise offered-load shape over one `LOOP_SECONDS` cycle. */
function scenarioAt(sec: number): { rps: number; phase: string } {
  const p = ((sec % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  const lerp = (a: number, b: number, u: number) => a + (b - a) * Math.min(1, Math.max(0, u));
  // gentle noise so the line never looks synthetic
  const jitter = 1 + 0.03 * Math.sin(sec * 2.7) + 0.02 * Math.sin(sec * 6.1);
  if (p < 9) return { rps: LO * jitter, phase: 'steady state — well inside capacity' };
  if (p < 24) return { rps: lerp(LO, HI, (p - 9) / 15) * jitter, phase: 'traffic climbing' };
  if (p < 28) return { rps: lerp(HI, SPIKE, (p - 24) / 4) * jitter, phase: 'flash spike incoming' };
  if (p < 33) return { rps: SPIKE * jitter, phase: 'spike — the pool is saturating' };
  if (p < 41) return { rps: lerp(SPIKE, LO * 1.15, (p - 33) / 8) * jitter, phase: 'draining the backlog' };
  return { rps: LO * 1.15 * jitter, phase: 'recovered' };
}

/**
 * Runs the real analytical solver on `design` at ~8 Hz, walking a scripted
 * offered-load curve. Pauses when the tab is hidden or `active` is false, so an
 * off-screen hero costs nothing. Every number returned is straight out of the
 * queueing engine — no mocking.
 */
export function useEngineLoop(design: SystemDesign, active: boolean) {
  // one working copy we mutate in place each tick
  const work = useMemo<SystemDesign>(() => {
    const clone: SystemDesign = JSON.parse(JSON.stringify(design));
    clone.sim.scenario.kind = 'constant';
    clone.sim.scenario.mode = 'rps';
    return clone;
  }, [design]);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [frame, setFrame] = useState<LoopFrame>(() => makeFrame(work, LO, 0, 'steady state'));
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const simRef = useRef(0);
  const wallRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    if (reduced) {
      // no animation: solve once at a representative busy load and stop
      const f = makeFrame(work, HI, 0, 'traffic climbing');
      setFrame(f);
      setSeries(staticSeries(work));
      return;
    }

    // setInterval, not rAF: this demo must keep ticking even when the pane
    // isn't the actively-painting surface. CPU is already bounded by `active`
    // (IntersectionObserver) and the `document.hidden` skip below.
    const id = window.setInterval(() => {
      if (document.hidden) return;
      simRef.current += SIM_STEP;
      wallRef.current += TICK_MS / 1000;
      const { rps, phase } = scenarioAt(simRef.current);
      const f = makeFrame(work, rps, wallRef.current, phase);
      setFrame(f);
      setSeries((prev) => {
        const next = prev.concat({
          t: f.t,
          offered: f.offered,
          served: f.served,
          p99ms: f.p99ms,
        });
        return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, reduced, work]);

  return { frame, series };
}

function makeFrame(work: SystemDesign, rps: number, t: number, phase: string): LoopFrame {
  work.sim.scenario.targetRps = Math.max(1, Math.round(rps));
  const r = solve(work);
  const rho: Record<string, number> = {};
  const over: Record<string, boolean> = {};
  for (const n of work.nodes) {
    const m = r.perNode[n.id]?.metrics;
    rho[n.id] = m ? m.rho : 0;
    over[n.id] = m ? m.overloaded : false;
  }
  return {
    t,
    offered: r.system.offeredRps,
    served: r.system.servedRps,
    p99ms: r.system.latency.p99 * 1000,
    success: r.system.successRate,
    rho,
    over,
    phase,
  };
}

/** A frozen curve for reduced-motion users: solve across the whole shape once. */
function staticSeries(work: SystemDesign): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let s = 0; s <= LOOP_SECONDS; s += 0.5) {
    work.sim.scenario.targetRps = Math.max(1, Math.round(scenarioAt(s).rps));
    const r = solve(work);
    out.push({
      t: s,
      offered: r.system.offeredRps,
      served: r.system.servedRps,
      p99ms: r.system.latency.p99 * 1000,
    });
  }
  return out;
}
