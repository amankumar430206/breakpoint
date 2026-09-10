import type { SystemDesign } from '@/engine';

/**
 * Calibration overlay — the Live Probe's measured numbers pushed back onto one
 * node's model. Same shape and lifecycle as a chaos `Fault`: a transient,
 * NOT-persisted overlay applied once at the `toDesign()` boundary so BOTH the
 * analytical solver and the DES see the calibrated node and stay in agreement.
 * Reversible: drop the entry and the node reverts to its authored params.
 */

export interface NodeCalibration {
  /** Measured service time (ms) → the node's dominant service-time param. */
  serviceTimeMs?: number;
  /** Measured error fraction 0..1 → the node's intrinsic error-rate param. */
  errorRate?: number;
}

export type CalibrationMap = Record<string, NodeCalibration>;

/** Which service-time param a calibration writes, per component type. */
const SERVICE_PARAM: Record<string, string> = {
  apiServer: 'serviceTimeMs',
  externalService: 'latencyMs',
};

/** Which error-rate param a calibration writes, per component type. */
const ERROR_PARAM: Record<string, string> = {
  apiServer: 'intrinsicErrorRate',
  externalService: 'errorRate',
};

/** Component types the Live Probe can calibrate (also gates the Inspector UI). */
export const CALIBRATABLE_TYPES = Object.keys(SERVICE_PARAM);

/** Return a new `SystemDesign` with every calibration merged into node params. Pure. */
export function applyCalibration(design: SystemDesign, cal: CalibrationMap): SystemDesign {
  if (!cal || !Object.keys(cal).length) return design;

  let touched = false;
  const nodes = design.nodes.map((n) => {
    const c = cal[n.id];
    if (!c) return n;
    const patch: Record<string, unknown> = {};

    const sKey = SERVICE_PARAM[n.type];
    if (sKey && typeof c.serviceTimeMs === 'number' && Number.isFinite(c.serviceTimeMs)) {
      patch[sKey] = Math.max(0.1, c.serviceTimeMs);
    }
    const eKey = ERROR_PARAM[n.type];
    if (eKey && typeof c.errorRate === 'number' && Number.isFinite(c.errorRate)) {
      patch[eKey] = Math.min(1, Math.max(0, c.errorRate));
    }

    if (!Object.keys(patch).length) return n;
    touched = true;
    return { ...n, params: { ...n.params, ...patch } };
  });

  return touched ? { ...design, nodes } : design;
}
