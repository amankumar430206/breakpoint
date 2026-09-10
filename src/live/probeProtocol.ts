import type { ProbeConfig } from './targetPolicy';
import type { Outcome, ProbeSummary, WindowStats } from './aggregate';

/** ~2 Hz — one windowed chart sample. */
export const PROBE_SAMPLE_MS = 500;

export interface ProbeTarget {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Header rows; blank keys are ignored. Never persisted. */
  headers: [string, string][];
  /** Request body for non-GET; sent verbatim. Never persisted. */
  body: string;
}

export type ToProbe =
  | { type: 'start'; target: ProbeTarget; config: ProbeConfig; nodeId: string }
  | { type: 'stop' };

/** One chart sample: wall-clock seconds since the run began + the window's stats. */
export interface ProbePoint extends WindowStats {
  t: number;
  /** The rate we were aiming for at this instant (for the "requested vs achieved" line). */
  targetRps: number;
}

export interface ProbeResult extends ProbeSummary {
  nodeId: string;
  target: string;
  mode: ProbeConfig['mode'];
  /** true when the worker halted the run early (cap hit / stop pressed). */
  stoppedEarly: boolean;
}

export type FromProbe =
  | { type: 'sample'; point: ProbePoint }
  | { type: 'done'; result: ProbeResult }
  | { type: 'error'; message: string };

export type { Outcome };
