import { create } from 'zustand';
import type { Analysis, EdgeMetrics, ExplainNote, NodeMetrics, SolveResult, SolveWarning } from '@/engine';
import type { SimNodeMetrics, SimSnapshot } from '@/engine/des';

export interface ViewSystem {
  offeredRps: number;
  servedRps: number;
  successRate: number;
  latency: { mean: number; p50: number; p95: number; p99: number };
  healthy: boolean;
}

/** One recorded point of the running simulation, for the metrics drawer. */
export interface SeriesPoint {
  t: number;
  offeredRps: number;
  servedRps: number;
  p99: number;
  successRate: number;
  /** ρ and p99 of the currently-selected node, if any. */
  nodeRho: number;
  nodeP99: number;
}

const SERIES_CAP = 600;

interface ViewState {
  mode: 'analytical' | 'live';
  /** Per-node metrics — the ONLY thing that changes at snapshot cadence.
   *  Each node subscribes to its own key so unrelated nodes never re-render. */
  perNode: Record<string, NodeMetrics>;
  perEdge: Record<string, EdgeMetrics>;
  /** Analytical extras, retained across live snapshots. */
  explains: Record<string, ExplainNote[]>;
  warnings: SolveWarning[];
  analysis: Analysis | null;
  converged: boolean;
  system: ViewSystem;
  simTime: number;
  /** True between dispatching a solve to the worker and its result landing —
   *  drives the "solving…" indicator (the analytical pass can be slow for
   *  very large server counts). */
  computing: boolean;
  /** Rolling time-series captured while the sim runs. */
  series: SeriesPoint[];
  /** Node whose per-node series to record (set by the drawer / selection). */
  seriesNodeId: string | null;

  setComputing: (v: boolean) => void;
  applyAnalytical: (result: SolveResult, analysis: Analysis, keepLive: boolean) => void;
  applySnapshot: (snap: SimSnapshot, ended: boolean) => void;
  setSeriesNode: (id: string | null) => void;
  clearSeries: () => void;
}

const EMPTY_SYSTEM: ViewSystem = {
  offeredRps: 0,
  servedRps: 0,
  successRate: 1,
  latency: { mean: 0, p50: 0, p95: 0, p99: 0 },
  healthy: true,
};

function fromSim(s: SimNodeMetrics): NodeMetrics {
  return {
    arrivalRate: s.arrivalRate,
    throughput: s.throughput,
    rho: s.rho,
    servers: s.servers,
    inSystem: s.inSystem,
    inQueue: s.inQueue,
    latency: s.latency,
    dropRate: s.dropRate,
    errorRate: s.errorRate,
    stable: !s.overloaded,
    overloaded: s.overloaded,
    backlogGrowth: s.backlogGrowth,
  };
}

/** Bucket a value so sub-visible jitter doesn't count as a change. `Infinity` /
 *  `NaN` are their own buckets (both mean "saturated"). */
function q(x: number, step: number): number {
  return Number.isFinite(x) ? Math.round(x / step) : x > 0 ? Infinity : NaN;
}

/**
 * True when two per-node metric sets are equal at display resolution. Lets
 * `applySnapshot` hand back the *previous* object reference for a quiescent
 * node, so memo'd `ComponentNode`s subscribed to `perNode[id]` stop
 * re-rendering ~15×/s when nothing about that node actually moved.
 */
function sameNodeMetrics(a: NodeMetrics, b: NodeMetrics): boolean {
  return (
    a.servers === b.servers &&
    a.overloaded === b.overloaded &&
    a.stable === b.stable &&
    Object.is(q(a.rho, 1e-3), q(b.rho, 1e-3)) &&
    Object.is(q(a.arrivalRate, 1e-2), q(b.arrivalRate, 1e-2)) &&
    Object.is(q(a.throughput, 1e-2), q(b.throughput, 1e-2)) &&
    Object.is(q(a.backlogGrowth, 1e-2), q(b.backlogGrowth, 1e-2)) &&
    Object.is(q(a.inQueue, 1e-2), q(b.inQueue, 1e-2)) &&
    Object.is(q(a.inSystem, 1e-2), q(b.inSystem, 1e-2)) &&
    Object.is(q(a.dropRate, 1e-4), q(b.dropRate, 1e-4)) &&
    Object.is(q(a.errorRate, 1e-4), q(b.errorRate, 1e-4)) &&
    Object.is(q(a.latency.mean, 1e-4), q(b.latency.mean, 1e-4)) &&
    Object.is(q(a.latency.p50, 1e-4), q(b.latency.p50, 1e-4)) &&
    Object.is(q(a.latency.p95, 1e-4), q(b.latency.p95, 1e-4)) &&
    Object.is(q(a.latency.p99, 1e-4), q(b.latency.p99, 1e-4))
  );
}

function sameEdgeMetrics(a: EdgeMetrics, b: EdgeMetrics): boolean {
  return (
    Object.is(q(a.flow, 1e-2), q(b.flow, 1e-2)) &&
    Object.is(q(a.retryFactor, 1e-3), q(b.retryFactor, 1e-3)) &&
    Object.is(q(a.timeoutRate, 1e-4), q(b.timeoutRate, 1e-4))
  );
}

export const useViewStore = create<ViewState>((set, get) => ({
  mode: 'analytical',
  perNode: {},
  perEdge: {},
  explains: {},
  warnings: [],
  analysis: null,
  converged: true,
  system: EMPTY_SYSTEM,
  simTime: 0,
  computing: false,
  series: [],
  seriesNodeId: null,

  setComputing: (v) => set({ computing: v }),

  applyAnalytical: (result, analysis, keepLive) => {
    const explains: Record<string, ExplainNote[]> = {};
    for (const [id, r] of Object.entries(result.perNode)) explains[id] = r.explain;

    if (keepLive && get().mode === 'live') {
      // Simulation is running — keep live per-node numbers, just refresh the
      // analytical audit + explanations.
      set({ explains, warnings: result.warnings, analysis, converged: result.converged, computing: false });
      return;
    }

    const perNode: Record<string, NodeMetrics> = {};
    for (const [id, r] of Object.entries(result.perNode)) perNode[id] = r.metrics;
    set({
      mode: 'analytical',
      perNode,
      perEdge: result.perEdge,
      explains,
      warnings: result.warnings,
      analysis,
      converged: result.converged,
      system: result.system,
      simTime: 0,
      computing: false,
      series: [],
    });
  },

  applySnapshot: (snap) => {
    const prevNode = get().perNode;
    const prevEdge = get().perEdge;

    // Reuse the previous entry object when a node/edge is unchanged at display
    // resolution — that's what lets memo'd ComponentNode / FlowEdge skip the
    // ~15 Hz re-render for the quiescent parts of the graph.
    const perNode: Record<string, NodeMetrics> = {};
    let anyOverloaded = false;
    let nodeChanged = false;
    for (const [id, m] of Object.entries(snap.perNode)) {
      const fresh = fromSim(m);
      if (fresh.overloaded) anyOverloaded = true;
      const prev = prevNode[id];
      if (prev && sameNodeMetrics(prev, fresh)) perNode[id] = prev;
      else {
        perNode[id] = fresh;
        nodeChanged = true;
      }
    }
    if (!nodeChanged && Object.keys(prevNode).length !== Object.keys(perNode).length) {
      nodeChanged = true;
    }

    const perEdge: Record<string, EdgeMetrics> = {};
    let edgeChanged = false;
    for (const [id, e] of Object.entries(snap.perEdge)) {
      const fresh: EdgeMetrics = {
        flow: e.flow,
        retryFactor: e.retryFactor,
        netLatencySec: 0,
        timeoutRate: e.timeoutRate,
      };
      const prev = prevEdge[id];
      if (prev && sameEdgeMetrics(prev, fresh)) perEdge[id] = prev;
      else {
        perEdge[id] = fresh;
        edgeChanged = true;
      }
    }
    if (!edgeChanged && Object.keys(prevEdge).length !== Object.keys(perEdge).length) {
      edgeChanged = true;
    }

    const perNodeOut = nodeChanged ? perNode : prevNode;
    const perEdgeOut = edgeChanged ? perEdge : prevEdge;

    const nid = get().seriesNodeId;
    const nodeM = nid ? perNodeOut[nid] : undefined;
    const point: SeriesPoint = {
      t: snap.simTime,
      offeredRps: snap.system.offeredRps,
      servedRps: snap.system.servedRps,
      p99: Number.isFinite(snap.system.latency.p99) ? snap.system.latency.p99 : 0,
      successRate: snap.system.successRate,
      nodeRho: nodeM ? nodeM.rho : 0,
      nodeP99: nodeM && Number.isFinite(nodeM.latency.p99) ? nodeM.latency.p99 : 0,
    };
    const prev = get().series;
    const series =
      prev.length >= SERIES_CAP ? [...prev.slice(prev.length - SERIES_CAP + 1), point] : [...prev, point];

    set({
      mode: 'live',
      perNode: perNodeOut,
      perEdge: perEdgeOut,
      system: {
        ...snap.system,
        healthy: !anyOverloaded,
      },
      simTime: snap.simTime,
      series,
    });
  },

  setSeriesNode: (id) => set({ seriesNodeId: id }),
  clearSeries: () => set({ series: [] }),
}));
