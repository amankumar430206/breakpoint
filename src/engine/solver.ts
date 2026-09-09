import { buildGraph, computeFlow, topoOrder, type Graph } from './flow';
import { getModel, hasModel } from './registry';
import { clamp01 } from './components/util';
import { idleMetrics } from './components/types';
import type {
  NodeMetrics,
  NodeResult,
  SolveResult,
  SolveWarning,
  SystemDesign,
} from './types';

const MAX_ITERATIONS = 80;
const INFLOW_TOL = 1e-5;
const FAIL_TOL = 1e-6;

/** Per-attempt failure probability of a node: dropped, or served-but-errored. */
function serviceFailure(m: NodeMetrics): number {
  return clamp01(m.dropRate + (1 - m.dropRate) * m.errorRate);
}

/** P(a request's sojourn at `m` exceeds `timeoutSec`). Sojourn ≈ Exp(mean) —
 *  exact for M/M/1, a monotone approximation elsewhere. 0 when no timeout set. */
function timeoutProb(m: NodeMetrics, timeoutSec: number | undefined): number {
  if (!timeoutSec || timeoutSec <= 0) return 0;
  const mean = m.latency.mean;
  if (!Number.isFinite(mean)) return m.overloaded ? 1 : 0;
  if (mean <= 0) return 0;
  return Math.exp(-timeoutSec / mean);
}

/** Compose two independent failure probabilities. */
const combineFail = (a: number, b: number): number => clamp01(1 - (1 - a) * (1 - b));

function validateParams(
  type: string,
  raw: Record<string, unknown>,
  warnings: SolveWarning[],
  nodeId: string,
): Record<string, unknown> {
  const model = getModel(type as never);
  const merged = { ...model.defaultParams, ...raw };
  const parsed = model.paramSchema.safeParse(merged);
  if (parsed.success) return parsed.data as Record<string, unknown>;
  warnings.push({
    level: 'warn',
    nodeId,
    message: `Invalid params on ${type} — using defaults. ${parsed.error.issues[0]?.message ?? ''}`,
  });
  return { ...model.defaultParams };
}

/** End-to-end failure probability of everything downstream of a node. */
function downstreamFailure(g: Graph, nodeId: string, metrics: Map<string, NodeMetrics>): number {
  const out = g.outEdges.get(nodeId) ?? [];
  let survive = 1;
  for (const e of out) {
    const vm = metrics.get(e.target);
    if (!vm) continue;
    const single = combineFail(serviceFailure(vm), timeoutProb(vm, e.params.timeoutSec));
    const retries = Math.max(0, Math.floor(e.params.retries ?? 0));
    const retriedFail = Math.pow(single, retries + 1);
    survive *= 1 - retriedFail;
  }
  return 1 - survive;
}

/** Longest-latency (critical) path latency from a node to any sink, per quantile. */
function suffixLatency(
  g: Graph,
  order: string[],
  metrics: Map<string, NodeMetrics>,
  pick: (m: NodeMetrics) => number,
  edgeNet: (edgeId: string) => number,
): Map<string, number> {
  const suffix = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const self = pick(metrics.get(id) ?? idleMetrics(1));
    const out = g.outEdges.get(id) ?? [];
    let best = 0;
    for (const e of out) {
      best = Math.max(best, edgeNet(e.id) + (suffix.get(e.target) ?? 0));
    }
    suffix.set(id, self + best);
  }
  return suffix;
}

/**
 * Public entry point. In `rps` mode this is a single steady-state solve at the
 * configured rate. In `users` mode it iterates the interactive response-time law
 * λ = N / (R + Z) to a fixed point: more users raise every node's utilization,
 * which raises the end-to-end response time R, which throttles the effective
 * request rate — so throughput plateaus instead of diverging.
 */
export function solve(design: SystemDesign): SolveResult {
  const sc = design.sim.scenario;
  if (sc.mode !== 'users') {
    return solveAtRate(design, Math.max(0, sc.targetRps));
  }

  const N = Math.max(0, sc.users ?? 0);
  const Z = Math.max(1e-3, sc.thinkTimeSec ?? 1);
  if (N === 0) return solveAtRate(design, 0);

  // Solve λ·(R(λ) + Z) = N by bisection. R(λ) rises with λ, so the left side is
  // monotincreasing — bisection on [0, N/Z] is stable even where R(λ) is stiff
  // around ρ = 1 (which is exactly where the damped fixed-point iteration stalls).
  const openLoop = N / Z; // λ if responses were instant — the upper bound
  let lo = 0;
  let hi = openLoop;
  let res = solveAtRate(design, hi);
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    res = solveAtRate(design, mid);
    const R = Number.isFinite(res.system.latency.mean) ? res.system.latency.mean : 1e9;
    const usersInSystem = mid * (R + Z); // little's law: N implied by this λ
    if (usersInSystem > N) hi = mid;
    else lo = mid;
  }
  return res;
}

function solveAtRate(design: SystemDesign, entryRate: number): SolveResult {
  const warnings: SolveWarning[] = [];
  const usable = design.nodes.filter((n) => {
    if (hasModel(n.type)) return true;
    warnings.push({ level: 'warn', nodeId: n.id, message: `Unknown component type "${n.type}" ignored.` });
    return false;
  });
  const g = buildGraph(usable, design.edges);
  const order = topoOrder(g);

  if (!order) {
    return {
      perNode: {},
      perEdge: {},
      system: {
        offeredRps: 0,
        servedRps: 0,
        latency: { mean: 0, p50: 0, p95: 0, p99: 0 },
        successRate: 0,
        healthy: false,
      },
      warnings: [
        { level: 'error', message: 'The graph has a cycle — request flow must be acyclic.' },
        ...warnings,
      ],
      iterations: 0,
      converged: false,
    };
  }
  const reverse = [...order].reverse();

  const params = new Map<string, Record<string, unknown>>();
  for (const n of usable) params.set(n.id, validateParams(n.type, n.params, warnings, n.id));

  entryRate = Math.max(0, entryRate);
  const clientCount = usable.filter((n) => n.type === 'client').length || 1;

  const metrics = new Map<string, NodeMetrics>(usable.map((n) => [n.id, idleMetrics(1)]));
  const explains = new Map<string, NodeResult['explain']>();
  const failure = new Map<string, number>(usable.map((n) => [n.id, 0]));

  let prevInflow = new Map<string, number>(usable.map((n) => [n.id, 0]));
  let flow = computeFlow({
    g,
    order,
    entryRate,
    outflowFraction: (id, inflow) =>
      getModel(g.byId.get(id)!.type).outflowFraction(params.get(id)!, {
        downstreamFailure: downstreamFailure(g, id, metrics),
        inflow,
      }),
    routingMode: (id) => getModel(g.byId.get(id)!.type).routing,
    selfLoad: (id) => {
      const mdl = getModel(g.byId.get(id)!.type);
      return mdl.selfLoad ? mdl.selfLoad(params.get(id)!) : 0;
    },
    attemptFailure: (e) =>
      combineFail(failure.get(e.target) ?? 0, timeoutProb(metrics.get(e.target) ?? idleMetrics(1), e.params.timeoutSec)),
  });

  let iterations = 0;
  let converged = false;
  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    iterations = iter;

    // Solve nodes downstream-first so each node sees its dependencies' errors.
    for (const id of reverse) {
      const node = g.byId.get(id)!;
      const model = getModel(node.type);
      const inflow = flow.nodeInflow.get(id) ?? 0;
      const dErr = downstreamFailure(g, id, metrics);
      const res = model.solve({ node, params: params.get(id)!, inflow, downstreamErrorRate: dErr });
      metrics.set(id, res.metrics);
      explains.set(id, res.explain);
    }

    // Refresh per-node failure estimates for the next flow pass.
    let maxFailDelta = 0;
    for (const id of order) {
      const f = serviceFailure(metrics.get(id)!);
      maxFailDelta = Math.max(maxFailDelta, Math.abs(f - (failure.get(id) ?? 0)));
      failure.set(id, f);
    }

    flow = computeFlow({
      g,
      order,
      entryRate,
      outflowFraction: (id, inflow) =>
      getModel(g.byId.get(id)!.type).outflowFraction(params.get(id)!, {
        downstreamFailure: downstreamFailure(g, id, metrics),
        inflow,
      }),
      routingMode: (id) => getModel(g.byId.get(id)!.type).routing,
    selfLoad: (id) => {
      const mdl = getModel(g.byId.get(id)!.type);
      return mdl.selfLoad ? mdl.selfLoad(params.get(id)!) : 0;
    },
      attemptFailure: (e) =>
      combineFail(failure.get(e.target) ?? 0, timeoutProb(metrics.get(e.target) ?? idleMetrics(1), e.params.timeoutSec)),
    });

    let maxInflowDelta = 0;
    for (const id of order) {
      const cur = flow.nodeInflow.get(id) ?? 0;
      const prev = prevInflow.get(id) ?? 0;
      const denom = Math.max(1, prev, cur);
      maxInflowDelta = Math.max(maxInflowDelta, Math.abs(cur - prev) / denom);
    }
    prevInflow = new Map(flow.nodeInflow);

    if (maxInflowDelta < INFLOW_TOL && maxFailDelta < FAIL_TOL) {
      converged = true;
      break;
    }
  }

  if (!converged) {
    warnings.push({
      level: 'warn',
      message:
        'Flow did not converge in 80 iterations — likely a retry storm (retries amplifying load faster than it drains). Reduce retries or add capacity.',
    });
  }

  // Assemble per-node output.
  const perNode: Record<string, NodeResult> = {};
  for (const n of usable) {
    perNode[n.id] = { metrics: metrics.get(n.id)!, explain: explains.get(n.id) ?? [] };
    if (metrics.get(n.id)!.overloaded) {
      warnings.push({ level: 'warn', nodeId: n.id, message: `${n.label ?? n.type} is overloaded (ρ ≥ 1).` });
    }
  }

  // Per-edge output.
  const perEdge: Record<string, SolveResult['perEdge'][string]> = {};
  for (const e of g.edges) {
    perEdge[e.id] = {
      flow: flow.edgeFlow.get(e.id) ?? 0,
      retryFactor: flow.edgeRetryFactor.get(e.id) ?? 1,
      netLatencySec: Math.max(0, e.params.netLatencyMs ?? 0) / 1000,
      timeoutRate: timeoutProb(metrics.get(e.target) ?? idleMetrics(1), e.params.timeoutSec),
    };
  }

  // System metrics.
  const edgeNet = (id: string) => perEdge[id]?.netLatencySec ?? 0;
  const smean = suffixLatency(g, order, metrics, (m) => m.latency.mean, edgeNet);
  const s50 = suffixLatency(g, order, metrics, (m) => m.latency.p50, edgeNet);
  const s95 = suffixLatency(g, order, metrics, (m) => m.latency.p95, edgeNet);
  const s99 = suffixLatency(g, order, metrics, (m) => m.latency.p99, edgeNet);
  const clients = usable.filter((n) => n.type === 'client');
  const pickMax = (m: Map<string, number>) =>
    clients.length ? Math.max(...clients.map((c) => m.get(c.id) ?? 0)) : 0;

  const endToEndFailure = clients.length
    ? clients.reduce((acc, c) => acc + downstreamFailure(g, c.id, metrics), 0) / clients.length
    : 1;
  const offeredRps = entryRate * clientCount;
  const successRate = clamp01(1 - endToEndFailure);
  const anyOverloaded = usable.some((n) => metrics.get(n.id)!.overloaded);

  return {
    perNode,
    perEdge,
    system: {
      offeredRps,
      servedRps: offeredRps * successRate,
      latency: { mean: pickMax(smean), p50: pickMax(s50), p95: pickMax(s95), p99: pickMax(s99) },
      successRate,
      healthy: !anyOverloaded && converged,
    },
    warnings,
    iterations,
    converged,
  };
}
