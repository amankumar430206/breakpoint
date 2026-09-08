import type { SimSnapshot } from '@/engine/des';
import type { Analysis, SolveResult, SystemDesign } from '@/engine';

export type ToWorker =
  | { type: 'init'; design: SystemDesign; running: boolean }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'setSpeed'; speed: number };

export type FromWorker =
  | { type: 'analysis'; result: SolveResult; analysis: Analysis }
  | { type: 'snapshot'; snap: SimSnapshot; running: boolean }
  | { type: 'ended'; snap: SimSnapshot };

/** Real-time cadence: advance + emit a snapshot at ~15 Hz (smooth, low churn). */
export const TICK_MS = 66;
