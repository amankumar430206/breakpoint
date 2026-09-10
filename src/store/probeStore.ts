import { create } from 'zustand';
import type { CalibrationMap } from '@/live/calibration';
import {
  DEFAULT_PROBE_CONFIG,
  DEFAULT_TIMEOUT_MS,
  type ProbeConfig,
} from '@/live/targetPolicy';
import type { ProbePoint, ProbeResult, ProbeTarget, ToProbe } from '@/live/probeProtocol';

/**
 * Live Probe state. Deliberately NOT persisted — no `localStorage` here. The
 * probe target (URL / headers / body) may hold credentials, and the design
 * document is written wholesale to `localStorage`, share URLs and JSON exports.
 * Same rule as `simStore.faults`.
 */

const SERIES_CAP = 600;

export type ProbeStatus = 'idle' | 'running' | 'done' | 'error';

export function emptyTarget(): ProbeTarget {
  return { url: '', method: 'GET', headers: [['', '']], body: '' };
}

/** A command the `useProbe` hook forwards to the worker, tagged so the effect fires once. */
export interface ProbeCommand {
  msg: ToProbe;
  nonce: number;
}

interface ProbeState {
  /** Per-node probe endpoint config. Keyed by design node id. */
  targets: Record<string, ProbeTarget>;
  config: ProbeConfig;

  status: ProbeStatus;
  error: string | null;
  /** Node the current / last run is bound to. */
  activeNodeId: string | null;
  series: ProbePoint[];
  result: ProbeResult | null;

  /** Transient per-node model overrides from a completed run. Not persisted. */
  calibration: CalibrationMap;

  /** Hosts the user has confirmed they're allowed to load-test. Per-session,
   *  keyed by hostname. Not persisted. */
  publicAck: Record<string, true>;

  /** Consumed by `useProbe`; the hook clears it after posting to the worker. */
  command: ProbeCommand | null;

  setTarget: (nodeId: string, patch: Partial<ProbeTarget>) => void;
  clearTarget: (nodeId: string) => void;
  setConfig: (patch: Partial<ProbeConfig>) => void;

  start: (nodeId: string) => void;
  stop: () => void;
  clearCommand: () => void;

  pushSample: (point: ProbePoint) => void;
  finishRun: (result: ProbeResult) => void;
  failRun: (message: string) => void;
  dismissResult: () => void;

  calibrateFromResult: (nodeId: string) => void;
  clearCalibration: (nodeId?: string) => void;

  ackPublicHost: (host: string) => void;
}

let nonce = 0;

export const useProbeStore = create<ProbeState>((set, get) => ({
  targets: {},
  config: { ...DEFAULT_PROBE_CONFIG, timeoutMs: DEFAULT_TIMEOUT_MS },

  status: 'idle',
  error: null,
  activeNodeId: null,
  series: [],
  result: null,
  calibration: {},
  publicAck: {},
  command: null,

  setTarget: (nodeId, patch) =>
    set((s) => ({
      targets: { ...s.targets, [nodeId]: { ...(s.targets[nodeId] ?? emptyTarget()), ...patch } },
    })),

  clearTarget: (nodeId) =>
    set((s) => {
      const next = { ...s.targets };
      delete next[nodeId];
      return { targets: next };
    }),

  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),

  start: (nodeId) => {
    const target = get().targets[nodeId];
    if (!target || !target.url.trim()) {
      set({ status: 'error', error: 'Set a target URL first.', activeNodeId: nodeId });
      return;
    }
    set({
      status: 'running',
      error: null,
      activeNodeId: nodeId,
      series: [],
      result: null,
      command: { nonce: ++nonce, msg: { type: 'start', target, config: get().config, nodeId } },
    });
  },

  stop: () => {
    if (get().status !== 'running') return;
    set({ command: { nonce: ++nonce, msg: { type: 'stop' } } });
  },

  clearCommand: () => set({ command: null }),

  pushSample: (point) =>
    set((s) => {
      if (s.status !== 'running') return s;
      const series =
        s.series.length >= SERIES_CAP
          ? [...s.series.slice(s.series.length - SERIES_CAP + 1), point]
          : [...s.series, point];
      return { series };
    }),

  finishRun: (result) => set({ status: 'done', result }),
  failRun: (message) => set({ status: 'error', error: message }),
  dismissResult: () => set({ status: 'idle', error: null, result: null, series: [] }),

  calibrateFromResult: (nodeId) => {
    const r = get().result;
    if (!r || r.nodeId !== nodeId) return;
    // p50 as the representative service time; measured error fraction as-is.
    // (For an apiServer with colocatedDb this slightly double-counts the DB
    //  portion — acceptable for a transient, reversible overlay.)
    set((s) => ({
      calibration: {
        ...s.calibration,
        [nodeId]: { serviceTimeMs: r.p50, errorRate: r.errorRate },
      },
    }));
  },

  clearCalibration: (nodeId) =>
    set((s) => {
      if (!nodeId) return { calibration: {} };
      const next = { ...s.calibration };
      delete next[nodeId];
      return { calibration: next };
    }),

  ackPublicHost: (host) => set((s) => ({ publicAck: { ...s.publicAck, [host]: true } })),
}));
