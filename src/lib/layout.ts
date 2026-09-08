import type { TmEdge, TmNode } from './design';

/** Layout / flow direction: top-to-bottom or left-to-right. */
export type FlowDir = 'TB' | 'LR';

const COL = 230; // spacing between siblings (TB) / between layers (LR)
const ROW = 150; // spacing between layers (TB) / between siblings (LR)

/**
 * Simple layered layout: depth = longest path from any source; nodes in a layer
 * are spread along the cross axis. `dir` picks the flow axis — 'TB' stacks
 * layers downward, 'LR' marches them rightward. Good enough for the
 * mostly-linear pipelines this tool builds.
 */
export function autoLayout(
  nodes: TmNode[],
  edges: TmEdge[],
  dir: FlowDir = 'TB',
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 0) return out;

  const inDeg = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!inDeg.has(e.source) || !inDeg.has(e.target)) continue;
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }

  // longest-path depth via Kahn
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const queue = nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const deg = new Map(inDeg);
  let processed = 0;
  while (queue.length) {
    const u = queue.shift()!;
    processed++;
    for (const v of adj.get(u) ?? []) {
      depth.set(v, Math.max(depth.get(v) ?? 0, (depth.get(u) ?? 0) + 1));
      deg.set(v, (deg.get(v) ?? 0) - 1);
      if ((deg.get(v) ?? 0) === 0) queue.push(v);
    }
  }
  // cycle fallback: keep original positions
  if (processed !== nodes.length) {
    for (const n of nodes) out[n.id] = n.position;
    return out;
  }

  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    const dpt = depth.get(n.id) ?? 0;
    (layers.get(dpt) ?? layers.set(dpt, []).get(dpt)!).push(n.id);
  }

  const layerGap = dir === 'TB' ? ROW : COL; // along the flow axis
  const siblingGap = dir === 'TB' ? COL : ROW; // across it

  for (const [dpt, ids] of layers) {
    const spread = (ids.length - 1) * siblingGap;
    ids.forEach((id, i) => {
      const along = dpt * layerGap;
      const across = Math.round(i * siblingGap - spread / 2 + 300);
      out[id] = dir === 'TB' ? { x: across, y: along } : { x: along, y: across };
    });
  }
  return out;
}
