import { percentiles, type QueueResult } from '../queueing';
import type { MemberMetrics, NodeMetrics } from '../types';

/**
 * Turn a raw `QueueResult` into the node-level `NodeMetrics` the UI consumes,
 * folding in an error rate and (for unbounded models) an overload backlog rate.
 */
export function metricsFromQueue(
  qr: QueueResult,
  opts: {
    offered: number;
    /** Total service capacity req/s (c·μ) — used for backlog growth when overloaded. */
    capacity: number;
    servers: number;
    /** Intrinsic error fraction of this component (0..1). */
    intrinsicErrorRate?: number;
    /** Error fraction bubbling up from downstream dependencies (0..1). */
    downstreamErrorRate?: number;
  },
): NodeMetrics {
  const intrinsic = clamp01(opts.intrinsicErrorRate ?? 0);
  const downstream = clamp01(opts.downstreamErrorRate ?? 0);
  // Independent failure sources compose multiplicatively on the success side.
  const errorRate = 1 - (1 - intrinsic) * (1 - downstream);

  const saturated = qr.rho >= 1;
  const excess = saturated ? Math.max(0, opts.offered - opts.capacity) : 0;

  // Unbounded model past saturation: no steady state — latency is unbounded and
  // the backlog grows without limit.
  if (!qr.stable) {
    return {
      arrivalRate: opts.offered,
      throughput: qr.throughput,
      rho: qr.rho,
      servers: opts.servers,
      inSystem: Infinity,
      inQueue: Infinity,
      latency: { mean: Infinity, p50: Infinity, p95: Infinity, p99: Infinity },
      dropRate: qr.pBlock,
      errorRate,
      stable: false,
      overloaded: true,
      backlogGrowth: excess,
    };
  }

  // Bounded model (or ρ < 1): a steady state exists. Served requests see finite
  // latency; excess load is shed as drops. Still flagged `overloaded` at ρ ≥ 1.
  const p = percentiles(qr, [0.5, 0.95, 0.99]);
  return {
    arrivalRate: opts.offered,
    throughput: qr.throughput * (1 - errorRate),
    rho: qr.rho,
    servers: opts.servers,
    inSystem: qr.L,
    inQueue: qr.Lq,
    latency: { mean: qr.W, p50: p.p50, p95: p.p95, p99: p.p99 },
    dropRate: qr.pBlock,
    errorRate,
    stable: !saturated,
    overloaded: saturated,
    backlogGrowth: excess,
  };
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Add a constant latency (e.g. fixed processing or network hop) to every stat. */
export function addLatency(m: NodeMetrics, deltaSec: number): NodeMetrics {
  if (deltaSec <= 0) return m;
  const bump = (x: number) => (Number.isFinite(x) ? x + deltaSec : x);
  return {
    ...m,
    latency: {
      mean: bump(m.latency.mean),
      p50: bump(m.latency.p50),
      p95: bump(m.latency.p95),
      p99: bump(m.latency.p99),
    },
  };
}

/**
 * Fold a set of per-instance metric sets (DB replicas, shards) into one
 * aggregate. ρ / overload / p99 take the worst instance (that's the constraint
 * users hit); throughput and drops sum / traffic-weight.
 */
export function blendMembers(
  parts: { label: string; role: string; offered: number; m: NodeMetrics; hot?: boolean }[],
): NodeMetrics {
  const totalOffered = parts.reduce((s, p) => s + p.offered, 0);
  const wsum = (pick: (m: NodeMetrics) => number) =>
    totalOffered > 0
      ? parts.reduce((s, p) => s + pick(p.m) * p.offered, 0) / totalOffered
      : 0;
  const worst = (pick: (m: NodeMetrics) => number) =>
    parts.reduce((mx, p) => Math.max(mx, pick(p.m)), 0);

  const members: MemberMetrics[] = parts.map((p) => ({
    role: p.role,
    label: p.label,
    arrivalRate: p.offered,
    rho: p.m.rho,
    latencyP99: p.m.latency.p99,
    dropRate: p.m.dropRate,
    hot: p.hot,
  }));

  return {
    arrivalRate: totalOffered,
    throughput: parts.reduce((s, p) => s + p.m.throughput, 0),
    rho: worst((m) => m.rho),
    servers: parts.reduce((s, p) => s + p.m.servers, 0),
    inSystem: parts.reduce((s, p) => s + (Number.isFinite(p.m.inSystem) ? p.m.inSystem : 0), 0),
    inQueue: parts.reduce((s, p) => s + (Number.isFinite(p.m.inQueue) ? p.m.inQueue : 0), 0),
    latency: {
      mean: wsum((m) => m.latency.mean),
      p50: wsum((m) => m.latency.p50),
      p95: worst((m) => m.latency.p95),
      p99: worst((m) => m.latency.p99),
    },
    dropRate: wsum((m) => m.dropRate),
    errorRate: wsum((m) => m.errorRate),
    stable: parts.every((p) => p.m.stable),
    overloaded: parts.some((p) => p.m.overloaded),
    backlogGrowth: parts.reduce((s, p) => s + p.m.backlogGrowth, 0),
    members,
  };
}

/** Traffic-weighted blend of two metric sets (used for read/write DB paths). */
export function blendMetrics(a: NodeMetrics, wa: number, b: NodeMetrics, wb: number): NodeMetrics {
  const tot = wa + wb || 1;
  const fa = wa / tot;
  const fb = wb / tot;
  const mix = (x: number, y: number) =>
    !Number.isFinite(x) || !Number.isFinite(y) ? Infinity : x * fa + y * fb;
  return {
    arrivalRate: a.arrivalRate + b.arrivalRate,
    throughput: a.throughput + b.throughput,
    rho: Math.max(a.rho, b.rho),
    servers: a.servers + b.servers,
    inSystem: mix(a.inSystem, b.inSystem),
    inQueue: mix(a.inQueue, b.inQueue),
    latency: {
      mean: mix(a.latency.mean, b.latency.mean),
      p50: mix(a.latency.p50, b.latency.p50),
      p95: mix(a.latency.p95, b.latency.p95),
      p99: mix(a.latency.p99, b.latency.p99),
    },
    dropRate: a.dropRate * fa + b.dropRate * fb,
    errorRate: a.errorRate * fa + b.errorRate * fb,
    stable: a.stable && b.stable,
    overloaded: a.overloaded || b.overloaded,
    backlogGrowth: a.backlogGrowth + b.backlogGrowth,
  };
}
