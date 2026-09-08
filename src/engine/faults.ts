import type { SystemDesign } from './types';

/**
 * Failure / chaos injection. A `Fault` is a transient overlay on the design —
 * it is NOT part of the saved document. It is applied once, at the boundary
 * where the React-Flow graph becomes an engine `SystemDesign`, so BOTH engines
 * (analytical `solve()` and the DES) see the same degraded design and stay in
 * agreement automatically.
 *
 *  - kill       drop a node and every edge touching it
 *  - partition  drop one edge
 *  - slow       add latency to the node's dominant service-time param
 *  - degrade    raise the node's error rate by `magnitude`
 *
 * Faults here are always-on while set (manual chaos). Timed faults
 * (`atSec` / `untilSec`) are a later addition.
 */
export type FaultKind = 'kill' | 'slow' | 'degrade' | 'partition';

export interface Fault {
  /** Stable key for the UI list — `${kind}:${targetId}`. */
  id: string;
  kind: FaultKind;
  /** Node id for kill / slow / degrade; edge id for partition. */
  targetId: string;
  /** slow → added latency in ms (default 300); degrade → added error rate 0..1 (default 0.25). */
  magnitude?: number;
}

export const faultId = (kind: FaultKind, targetId: string): string => `${kind}:${targetId}`;

/** The service-time param a `slow` fault inflates, per component type. */
const SLOW_PARAM: Record<string, string> = {
  apiServer: 'serviceTimeMs',
  worker: 'jobTimeMs',
  sqlDatabase: 'queryTimeMs',
  loadBalancer: 'latencyMs',
  cache: 'hitLatencyMs',
  cdn: 'edgeLatencyMs',
  objectStore: 'opLatencyMs',
  externalService: 'latencyMs',
};

/** The error-rate param a `degrade` fault raises, per component type. */
const DEGRADE_PARAM: Record<string, string> = {
  apiServer: 'intrinsicErrorRate',
  worker: 'intrinsicErrorRate',
  sqlDatabase: 'intrinsicErrorRate',
  cache: 'intrinsicErrorRate',
  cdn: 'intrinsicErrorRate',
  objectStore: 'intrinsicErrorRate',
  externalService: 'errorRate',
};

const numAt = (obj: Record<string, unknown>, key: string): number =>
  typeof obj[key] === 'number' && Number.isFinite(obj[key] as number) ? (obj[key] as number) : 0;

/** Return a new `SystemDesign` with every fault applied. Pure. */
export function applyFaults(design: SystemDesign, faults: Fault[]): SystemDesign {
  if (!faults.length) return design;

  const killed = new Set<string>();
  const cut = new Set<string>();
  for (const f of faults) {
    if (f.kind === 'kill') killed.add(f.targetId);
    else if (f.kind === 'partition') cut.add(f.targetId);
  }

  let nodes = killed.size ? design.nodes.filter((n) => !killed.has(n.id)) : design.nodes;
  const edges = design.edges.filter(
    (e) => !cut.has(e.id) && !killed.has(e.source) && !killed.has(e.target),
  );

  const patches = new Map<string, Record<string, unknown>>();
  for (const f of faults) {
    if (f.kind !== 'slow' && f.kind !== 'degrade') continue;
    if (killed.has(f.targetId)) continue;
    const node = nodes.find((n) => n.id === f.targetId);
    if (!node) continue;
    const key = (f.kind === 'slow' ? SLOW_PARAM : DEGRADE_PARAM)[node.type];
    if (!key) continue;
    const cur = patches.get(node.id) ?? {};
    const base = key in cur ? numAt(cur, key) : numAt(node.params, key);
    cur[key] =
      f.kind === 'slow'
        ? base + (f.magnitude ?? 300)
        : Math.min(1, base + (f.magnitude ?? 0.25));
    patches.set(node.id, cur);
  }

  if (patches.size) {
    nodes = nodes.map((n) =>
      patches.has(n.id) ? { ...n, params: { ...n.params, ...patches.get(n.id) } } : n,
    );
  }

  return { ...design, nodes, edges };
}
