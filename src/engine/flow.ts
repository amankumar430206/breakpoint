import type { EdgeSpec, NodeSpec } from './types';

export interface Graph {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  byId: Map<string, NodeSpec>;
  outEdges: Map<string, EdgeSpec[]>;
  inEdges: Map<string, EdgeSpec[]>;
}

export function buildGraph(nodes: NodeSpec[], edges: EdgeSpec[]): Graph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, EdgeSpec[]>();
  const inEdges = new Map<string, EdgeSpec[]>();
  for (const n of nodes) {
    outEdges.set(n.id, []);
    inEdges.set(n.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    outEdges.get(e.source)!.push(e);
    inEdges.get(e.target)!.push(e);
  }
  return { nodes, edges, byId, outEdges, inEdges };
}

/** Kahn topological sort. Returns null if the graph has a directed cycle. */
export function topoOrder(g: Graph): string[] | null {
  const indeg = new Map<string, number>();
  for (const n of g.nodes) indeg.set(n.id, g.inEdges.get(n.id)!.length);
  const queue = g.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const u = queue.shift()!;
    order.push(u);
    for (const e of g.outEdges.get(u)!) {
      const d = indeg.get(e.target)! - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  return order.length === g.nodes.length ? order : null;
}

/** Expected number of attempts for a call retried up to `retries` times against
 *  a dependency that fails with probability `p` per attempt. */
export function expectedAttempts(p: number, retries: number): number {
  const R = Math.max(0, Math.floor(retries));
  if (R === 0) return 1;
  const q = Math.min(0.999999, Math.max(0, p));
  if (q === 0) return 1;
  // Σ_{k=0}^{R} q^k
  return (1 - Math.pow(q, R + 1)) / (1 - q);
}

export interface FlowInput {
  g: Graph;
  order: string[];
  /** Arrival rate injected at each client node (req/s). */
  entryRate: number;
  /** Fraction of a node's inflow that continues downstream (from the model).
   *  `inflow` is passed so load-dependent gates (rate limiters) can shed. */
  outflowFraction: (nodeId: string, inflow: number) => number;
  /** Routing mode of a node's model. */
  routingMode: (nodeId: string) => 'passthrough' | 'replicate' | 'branch' | 'sink';
  /** Per-attempt failure probability of a *call over this edge* — the target
   *  node's service failure combined with the edge's timeout probability. */
  attemptFailure: (edge: EdgeSpec) => number;
  /** Baseline load a node originates on its own (a scheduled batch job), req/s.
   *  0 for everything else. */
  selfLoad?: (nodeId: string) => number;
}

export interface FlowOutput {
  nodeInflow: Map<string, number>;
  edgeFlow: Map<string, number>;
  edgeRetryFactor: Map<string, number>;
}

/**
 * One forward pass of the flow equations. Given each node's current failure
 * estimate, compute the offered arrival rate at every node and the (retry-
 * amplified) flow on every edge. The caller iterates this to a fixed point.
 */
export function computeFlow(input: FlowInput): FlowOutput {
  const { g, order, entryRate, outflowFraction, routingMode, attemptFailure, selfLoad } = input;
  const nodeInflow = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  const edgeFlow = new Map<string, number>();
  const edgeRetryFactor = new Map<string, number>();

  for (const id of order) {
    const node = g.byId.get(id)!;
    if (node.type === 'client') {
      nodeInflow.set(id, nodeInflow.get(id)! + entryRate);
    }
    const own = selfLoad?.(id) ?? 0;
    if (own > 0) nodeInflow.set(id, nodeInflow.get(id)! + own);
    const inflow = nodeInflow.get(id)!;
    const out = g.outEdges.get(id)!;
    if (out.length === 0) continue;

    const mode = routingMode(id);
    if (mode === 'sink') continue;
    const forwardable = inflow * outflowFraction(id, inflow);
    if (forwardable <= 0) {
      for (const e of out) {
        edgeFlow.set(e.id, 0);
        edgeRetryFactor.set(e.id, 1);
      }
      continue;
    }

    const totalWeight = out.reduce((s, e) => s + (e.params.weight ?? 1), 0) || out.length;

    for (const e of out) {
      const share =
        mode === 'replicate'
          ? forwardable
          : forwardable * ((e.params.weight ?? 1) / totalWeight);
      const calls = share * (e.params.callsPerRequest ?? 1);
      const amp = expectedAttempts(attemptFailure(e), e.params.retries ?? 0);
      const flow = calls * amp;
      edgeFlow.set(e.id, flow);
      edgeRetryFactor.set(e.id, amp);
      nodeInflow.set(e.target, nodeInflow.get(e.target)! + flow);
    }
  }

  return { nodeInflow, edgeFlow, edgeRetryFactor };
}
