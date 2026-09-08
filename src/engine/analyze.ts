import { deriveConcurrency } from './components/apiServer';
import { solve } from './solver';
import type { NodeSpec, SolveResult, SystemDesign } from './types';

export interface Bottleneck {
  nodeId: string;
  label: string;
  severity: 'critical' | 'warning';
  /** Dominant symptom. */
  metric: 'utilization' | 'drops' | 'backlog' | 'latency';
  reason: string;
}

export interface Fix {
  nodeId: string;
  label: string;
  /** Params to merge onto the node. */
  patch: Record<string, unknown>;
  /** Rough relative expense (lower is cheaper). */
  cost: number;
  costHint: string;
  /** System success rate this fix would produce. */
  projectedSuccess: number;
  projectedMaxRho: number;
  /** True if it makes the whole system healthy. */
  clears: boolean;
}

export interface Capacity {
  /** Letter grade for the current design at the current load. */
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | '—';
  /** Roughly how many times the current load it can take before the busiest
   *  component saturates (linear approximation from its current ρ). */
  headroom: number;
  /** Load level (in `unit`) at which it starts to break. */
  breaksAt: number;
  unit: 'rps' | 'users';
  note: string;
}

export interface Analysis {
  healthy: boolean;
  bottlenecks: Bottleneck[];
  /** Ranked: clearing + cheapest first. */
  fixes: Fix[];
  summary: string;
  /** Headline grade + how much room to grow. */
  capacity: Capacity;
}

const RHO_WARN = 0.8;
const RHO_CRIT = 0.98;
const DROP_WARN = 0.01;

function estimateCapacity(design: SystemDesign, result: SolveResult): Capacity {
  const sc = design.sim.scenario;
  const unit: 'rps' | 'users' = sc.mode === 'users' ? 'users' : 'rps';
  const base = unit === 'users' ? (sc.users ?? 0) : sc.targetRps;
  const nodes = Object.values(result.perNode);

  if (base <= 0 || nodes.length === 0 || design.nodes.every((n) => n.type === 'client')) {
    return { grade: '—', headroom: 0, breaksAt: 0, unit, note: 'Add components and a load to grade the design.' };
  }

  const maxRho = Math.max(0, ...nodes.map((n) => (Number.isFinite(n.metrics.rho) ? n.metrics.rho : 9)));
  const worstDrop = Math.max(0, ...nodes.map((n) => n.metrics.dropRate));
  const success = result.system.successRate;

  // ρ scales ~linearly with system load; room to grow until the busiest node
  // reaches ~0.95 utilization.
  let headroom = maxRho > 0.01 ? 0.95 / maxRho : 50;
  if (worstDrop > DROP_WARN || success < 0.97 || !result.converged) headroom = Math.min(headroom, 0.9);
  headroom = Math.max(0.1, Math.min(50, headroom));
  const breaksAt = Math.round(base * headroom);

  let grade: Capacity['grade'];
  if (headroom < 1 || success < 0.9) grade = 'F';
  else if (headroom < 1.15) grade = 'D';
  else if (headroom < 1.8) grade = 'C';
  else if (headroom < 3.5) grade = 'B';
  else grade = success > 0.995 && maxRho < 0.6 ? 'A' : 'B';

  let note: string;
  if (grade === 'F') note = `Over capacity — shedding ${((1 - success) * 100).toFixed(0)}% of requests now.`;
  else if (grade === 'D') note = 'Right at the edge — almost no headroom.';
  else {
    const at = breaksAt >= 1000 ? `${(breaksAt / 1000).toFixed(1)}k` : `${breaksAt}`;
    note = `~${headroom.toFixed(1)}× headroom — strains around ${at} ${unit}.`;
  }

  return { grade, headroom, breaksAt, unit, note };
}

/** Inspect a solved design, name what's blocking it, and search one-step fixes. */
export function analyze(design: SystemDesign, result: SolveResult): Analysis {
  const bottlenecks: Bottleneck[] = [];

  for (const n of design.nodes) {
    const r = result.perNode[n.id];
    if (!r) continue;
    const m = r.metrics;
    const label = n.label ?? n.type;

    if (m.overloaded || m.rho >= RHO_CRIT) {
      bottlenecks.push({
        nodeId: n.id,
        label,
        severity: 'critical',
        metric: m.dropRate > DROP_WARN ? 'drops' : m.backlogGrowth > 0 ? 'backlog' : 'utilization',
        reason:
          m.dropRate > DROP_WARN
            ? `ρ ${m.rho.toFixed(2)} — shedding ${(m.dropRate * 100).toFixed(0)}% of requests`
            : m.backlogGrowth > 0
              ? `ρ ${m.rho.toFixed(2)} — backlog growing ≈ ${m.backlogGrowth.toFixed(0)}/s`
              : `ρ ${m.rho.toFixed(2)} — saturated`,
      });
    } else if (m.rho >= RHO_WARN || m.dropRate > DROP_WARN / 5) {
      bottlenecks.push({
        nodeId: n.id,
        label,
        severity: 'warning',
        metric: 'utilization',
        reason: `ρ ${m.rho.toFixed(2)} — little headroom left`,
      });
    }
  }

  bottlenecks.sort(
    (a, b) =>
      (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) ||
      (result.perNode[b.nodeId]?.metrics.rho ?? 0) - (result.perNode[a.nodeId]?.metrics.rho ?? 0),
  );

  const capacity = estimateCapacity(design, result);
  const healthy = bottlenecks.length === 0 && result.system.successRate > 0.98;
  if (healthy) {
    return {
      healthy: true,
      bottlenecks: [],
      fixes: [],
      summary: 'No component is close to its limit.',
      capacity,
    };
  }

  const fixes = rankFixes(design, result, bottlenecks);
  const worst = bottlenecks[0];
  const top = fixes[0];
  let tail = ' No single-step fix helps much here — combine several.';
  if (top?.clears) tail = ` Cheapest fix that clears it: ${top.label}.`;
  else if (top) tail = ` Best single fix: ${top.label} — won't fully clear it, so stack a few.`;
  const summary = worst ? `${worst.label} is the bottleneck (${worst.reason}).${tail}` : 'System is under strain.';

  return { healthy: false, bottlenecks, fixes, summary, capacity };
}

/** Candidate single-parameter changes, scored by re-solving. */
function rankFixes(
  design: SystemDesign,
  base: SolveResult,
  bottlenecks: Bottleneck[],
): Fix[] {
  const candidates: Omit<Fix, 'projectedSuccess' | 'projectedMaxRho' | 'clears'>[] = [];
  const targets = new Set(bottlenecks.map((b) => b.nodeId));

  for (const n of design.nodes) {
    if (!targets.has(n.id)) continue;
    const p = n.params;

    if (n.type === 'apiServer') {
      const replicas = numOr(p.replicas, 1);
      const sizing = deriveConcurrency(p);
      candidates.push({
        nodeId: n.id,
        label: `Add a replica to ${lbl(n)} (${replicas} → ${replicas + 1})`,
        patch: { replicas: replicas + 1 },
        cost: 10,
        costHint: '+1 instance',
      });
      candidates.push({
        nodeId: n.id,
        label: `Double replicas of ${lbl(n)} (${replicas} → ${replicas * 2})`,
        patch: { replicas: replicas * 2 },
        cost: 10 * replicas,
        costHint: `+${replicas} instances`,
      });
      if (sizing.bound === 'ram') {
        candidates.push({
          nodeId: n.id,
          label: `Double RAM on ${lbl(n)} (it's RAM-bound)`,
          patch: { ramGB: numOr(p.ramGB, 4) * 2 },
          cost: 6,
          costHint: 'larger instance',
        });
      } else {
        candidates.push({
          nodeId: n.id,
          label: `Double vCPUs on ${lbl(n)}`,
          patch: { vcpus: numOr(p.vcpus, 2) * 2 },
          cost: 8 * Math.max(1, replicas),
          costHint: 'larger instance',
        });
      }
      candidates.push({
        nodeId: n.id,
        label: `Optimize ${lbl(n)} handler (service time −30%)`,
        patch: { serviceTimeMs: numOr(p.serviceTimeMs, 40) * 0.7 },
        cost: 4,
        costHint: 'code change',
      });
      if (!p.autoscale) {
        candidates.push({
          nodeId: n.id,
          label: `Enable autoscaling on ${lbl(n)}`,
          patch: { autoscale: true },
          cost: 5,
          costHint: 'config',
        });
      }
    }

    if (n.type === 'sqlDatabase') {
      const arch = typeof p.architecture === 'string' ? p.architecture : 'primary-replica';
      const readRatio = numOr(p.readRatio, 0.8);
      const writeRatio = 1 - readRatio;

      // architecture-specific scale-out
      if (arch === 'primary-replica' && readRatio > 0.4) {
        const rr = numOr(p.readReplicas, 0);
        candidates.push({
          nodeId: n.id,
          label: `Add a read replica to ${lbl(n)} (${rr} → ${rr + 1})`,
          patch: { readReplicas: rr + 1 },
          cost: 9,
          costHint: '+1 DB instance',
        });
      }
      if (arch === 'multi-primary') {
        const np = numOr(p.primaries, 3);
        candidates.push({
          nodeId: n.id,
          label: `Add a primary to ${lbl(n)} (${np} → ${np + 1})`,
          patch: { primaries: np + 1 },
          cost: 12,
          costHint: '+1 primary',
        });
      }
      if (arch === 'sharded') {
        const ns = numOr(p.shards, 4);
        candidates.push({
          nodeId: n.id,
          label: `Add shards to ${lbl(n)} (${ns} → ${ns * 2})`,
          patch: { shards: ns * 2 },
          cost: 10,
          costHint: `+${ns} shards`,
        });
        if (p.keyDistribution === 'zipfian') {
          candidates.push({
            nodeId: n.id,
            label: `Rebalance ${lbl(n)} with a better shard key (skew → uniform)`,
            patch: { keyDistribution: 'uniform' },
            cost: 5,
            costHint: 'key redesign',
          });
        }
      }
      // topology switch when a non-sharded DB is write-bound
      if (arch !== 'sharded' && writeRatio > 0.35) {
        candidates.push({
          nodeId: n.id,
          label: `Shard ${lbl(n)} by key (write-bound — replicas won't help)`,
          patch: { architecture: 'sharded', shards: 4 },
          cost: 14,
          costHint: 'data-layer change',
        });
      }
      if (arch === 'single' && readRatio > 0.5) {
        candidates.push({
          nodeId: n.id,
          label: `Move ${lbl(n)} to primary + 2 read replicas`,
          patch: { architecture: 'primary-replica', readReplicas: 2 },
          cost: 11,
          costHint: '+2 DB instances',
        });
      }

      candidates.push({
        nodeId: n.id,
        label: `Grow ${lbl(n)} connection pool (${numOr(p.poolSize, 20)} → ${Math.round(numOr(p.poolSize, 20) * 1.5)})`,
        patch: { poolSize: Math.round(numOr(p.poolSize, 20) * 1.5) },
        cost: 3,
        costHint: 'config',
      });
      candidates.push({
        nodeId: n.id,
        label: `Add an index on ${lbl(n)} (query time −40%)`,
        patch: { queryTimeMs: numOr(p.queryTimeMs, 8) * 0.6 },
        cost: 3,
        costHint: 'schema change',
      });
    }

    if (n.type === 'loadBalancer') {
      candidates.push({
        nodeId: n.id,
        label: `Double ${lbl(n)} capacity`,
        patch: { capacityRps: numOr(p.capacityRps, 50000) * 2 },
        cost: 8,
        costHint: 'bigger LB',
      });
    }

    if (n.type === 'cache') {
      const hr = numOr(p.hitRatio, 0.8);
      if (hr < 0.98) {
        candidates.push({
          nodeId: n.id,
          label: `Raise ${lbl(n)} hit ratio (${hr.toFixed(2)} → ${Math.min(0.99, hr + 0.05).toFixed(2)})`,
          patch: { hitRatio: Math.min(0.99, hr + 0.05) },
          cost: 4,
          costHint: 'cache tuning',
        });
      }
    }
  }

  // Also: raising the hit ratio of a cache *upstream* of a DB bottleneck helps.
  for (const n of design.nodes) {
    if (n.type !== 'cache' || targets.has(n.id)) continue;
    const feedsBottleneck = design.edges.some(
      (e) => e.source === n.id && targets.has(e.target),
    );
    const hr = numOr(n.params.hitRatio, 0.8);
    if (feedsBottleneck && hr < 0.98) {
      candidates.push({
        nodeId: n.id,
        label: `Raise ${lbl(n)} hit ratio to take load off downstream (${hr.toFixed(2)} → ${Math.min(0.99, hr + 0.1).toFixed(2)})`,
        patch: { hitRatio: Math.min(0.99, hr + 0.1) },
        cost: 4,
        costHint: 'cache tuning',
      });
    }
  }

  const scored: Fix[] = candidates.map((c) => {
    const patched = patchDesign(design, c.nodeId, c.patch);
    const res = solve(patched);
    const maxRho = Math.max(
      0,
      ...Object.values(res.perNode).map((r) => (Number.isFinite(r.metrics.rho) ? r.metrics.rho : 5)),
    );
    const success = Number.isFinite(res.system.successRate) ? res.system.successRate : 0;
    const clears = success > 0.985 && maxRho < RHO_WARN;
    return {
      ...c,
      projectedSuccess: success,
      projectedMaxRho: maxRho,
      clears,
    };
  });

  const baseSuccess = base.system.successRate;
  const baseMaxRho = Math.max(
    0,
    ...Object.values(base.perNode).map((r) => (Number.isFinite(r.metrics.rho) ? r.metrics.rho : 5)),
  );
  return scored
    .filter(
      (f) =>
        f.clears ||
        f.projectedSuccess > baseSuccess + 0.001 ||
        f.projectedMaxRho < baseMaxRho - 0.05,
    )
    .sort(
      (a, b) =>
        Number(b.clears) - Number(a.clears) ||
        a.cost - b.cost ||
        b.projectedSuccess - a.projectedSuccess,
    )
    .slice(0, 4);
}

function patchDesign(design: SystemDesign, nodeId: string, patch: Record<string, unknown>): SystemDesign {
  return {
    ...design,
    nodes: design.nodes.map((n) =>
      n.id === nodeId ? { ...n, params: { ...n.params, ...patch } } : n,
    ),
  };
}

const numOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const lbl = (n: NodeSpec) => n.label ?? n.type;
