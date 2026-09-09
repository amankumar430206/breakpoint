import { DB_ENGINES, type DbEngine } from './components/sqlDatabase';
import type { NodeSpec, SolveResult, SystemDesign } from './types';

/**
 * The design-review advisor — the qualitative complement to the numeric
 * bottleneck audit. It reads the graph plus the solved metrics and names the
 * system-design patterns the design implies (CAP posture, replication, sharding,
 * load-balancing, proxy roles, caching, resilience) with a "use it when…" hint
 * and a link into `docs/concepts.md`.
 *
 * Pure and cheap: no extra simulation, just structural inspection.
 */
export interface Advice {
  /** Short topic label, e.g. "CAP posture". */
  topic: string;
  /** One-line conclusion about this design. */
  verdict: string;
  /** Why — the specific thing in the design that led here. */
  why: string;
  /** When this pattern / choice is the right one. */
  useWhen: string;
  severity: 'info' | 'note' | 'warn';
  /** Anchor into docs/concepts.md. */
  docHref: string;
}

const DOC = 'docs/concepts.md';

const numOr = (v: unknown, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;
const strOr = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const lbl = (n: NodeSpec): string => n.label ?? n.type;

interface Adj {
  /** node id -> ids it sends to */
  fwd: Map<string, string[]>;
  /** node id -> ids that send to it */
  rev: Map<string, string[]>;
  byId: Map<string, NodeSpec>;
}

function adjacency(design: SystemDesign): Adj {
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  for (const n of design.nodes) {
    fwd.set(n.id, []);
    rev.set(n.id, []);
  }
  for (const e of design.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    fwd.get(e.source)!.push(e.target);
    rev.get(e.target)!.push(e.source);
  }
  return { fwd, rev, byId };
}

/** Is there a node of one of `types` anywhere upstream of `id`? */
function hasUpstream(adj: Adj, id: string, types: Set<string>): boolean {
  const seen = new Set<string>([id]);
  const stack = [...(adj.rev.get(id) ?? [])];
  while (stack.length) {
    const u = stack.pop()!;
    if (seen.has(u)) continue;
    seen.add(u);
    if (types.has(adj.byId.get(u)?.type ?? '')) return true;
    stack.push(...(adj.rev.get(u) ?? []));
  }
  return false;
}

/** Is `id` directly fed by a node of one of `types` (one hop upstream)? */
function directlyBehind(adj: Adj, id: string, types: Set<string>): boolean {
  return (adj.rev.get(id) ?? []).some((u) => types.has(adj.byId.get(u)?.type ?? ''));
}

export function advise(design: SystemDesign, result: SolveResult): Advice[] {
  const out: Advice[] = [];
  const adj = adjacency(design);
  const metricsOf = (id: string) => result.perNode[id]?.metrics;

  const dbs = design.nodes.filter((n) => n.type === 'sqlDatabase');
  const apps = design.nodes.filter((n) => n.type === 'apiServer');
  const externals = design.nodes.filter((n) => n.type === 'externalService');

  for (const db of dbs) {
    const p = db.params;
    const arch = strOr(p.architecture, 'primary-replica');
    const engineKey = strOr(p.engine, 'postgres') as DbEngine;
    const eng = DB_ENGINES[engineKey] ?? DB_ENGINES.postgres;
    const readRatio = numOr(p.readRatio, 0.8);
    const writeRatio = 1 - readRatio;
    const lag = numOr(p.replicationLagMs, 50);
    const m = metricsOf(db.id);
    const name = lbl(db);

    // --- CAP posture -------------------------------------------------------
    if (arch === 'single') {
      out.push({
        topic: 'CAP posture',
        verdict: `${name}: CP, single node — consistent but not partition-tolerant, and a single point of failure.`,
        why: `One ${eng.label} node serves every read and write.`,
        useWhen:
          'Early stage, or a bounded dataset where a short outage on failover is acceptable and you value strong consistency.',
        severity: 'note',
        docHref: `${DOC}#cap`,
      });
    } else if (arch === 'primary-replica') {
      out.push({
        topic: 'CAP posture',
        verdict: `${name}: AP-leaning — replica reads can be ~${lag} ms stale.`,
        why: `Async ${arch} (${eng.label}); reads are served from replicas that trail the primary.`,
        useWhen:
          'Feeds, catalogs, timelines — anywhere a slightly stale read is fine. Not account balances, inventory counts, or anything read-modify-write.',
        severity: 'note',
        docHref: `${DOC}#replication`,
      });
    } else if (arch === 'multi-primary') {
      const coord = numOr(p.writeCoordinationPct, 15);
      out.push({
        topic: 'CAP posture',
        verdict: `${name}: CP-leaning — every write certified across the other primaries.`,
        why: `multi-primary with ${coord}% coordination cost per extra primary; write latency grows with the primary count.`,
        useWhen:
          'Multi-region writes where stale reads are unacceptable and you can pay the write-latency tax. Otherwise prefer one primary + replicas.',
        severity: 'note',
        docHref: `${DOC}#cap`,
      });
    } else if (arch === 'sharded') {
      out.push({
        topic: 'CAP posture',
        verdict: `${name}: per-shard CP, no cross-shard guarantees.`,
        why: `Sharded by key — a single-key op is consistent, a cross-shard query/transaction is not.`,
        useWhen:
          'Write-scalable workloads with a natural partition key and few cross-partition queries.',
        severity: 'info',
        docHref: `${DOC}#sharding`,
      });
    }
    if (eng.capDefault === 'AP' && arch !== 'single') {
      out.push({
        topic: 'Consistency tuning',
        verdict: `${eng.label} lets you trade consistency per query.`,
        why: `${eng.label} is AP by default${eng.quorumWrites ? ' with tunable quorum (R + W > N for strong reads)' : ''}.`,
        useWhen:
          'Raise the read/write quorum only on the operations that need it — keep the cheap path for the rest.',
        severity: 'info',
        docHref: `${DOC}#cap`,
      });
    }

    // --- Read/write split & replication ---------------------------------
    const cacheInFront = directlyBehind(adj, db.id, new Set(['cache']));
    if (
      (arch === 'single' || arch === 'primary-replica') &&
      readRatio >= 0.7 &&
      numOr(p.readReplicas, 0) === 0 &&
      !cacheInFront
    ) {
      out.push({
        topic: 'Read/write split',
        verdict: `${name}: ${Math.round(readRatio * 100)}% reads all hitting one primary.`,
        why: 'No read replicas and no look-aside cache in front.',
        useWhen:
          'Add a read replica (master–slave: promote it on primary loss, expect a brief write outage) or a cache-aside layer once reads dominate.',
        severity: 'warn',
        docHref: `${DOC}#replication`,
      });
    }

    // --- Sharding vs replication --------------------------------------
    if (m?.overloaded && writeRatio >= 0.35 && arch !== 'sharded') {
      out.push({
        topic: 'Sharding',
        verdict: `${name} is write-bound and saturated — replicas won't help.`,
        why: `${Math.round(writeRatio * 100)}% writes; read replicas only scale reads.`,
        useWhen:
          'Shard by a key with even distribution (consistent hashing) so writes spread across independent nodes.',
        severity: 'warn',
        docHref: `${DOC}#sharding`,
      });
    }
    if (arch === 'sharded' && strOr(p.keyDistribution, 'uniform') === 'zipfian') {
      const hot = m?.members?.some((mm) => mm.hot);
      if (hot) {
        out.push({
          topic: 'Hot shard',
          verdict: `${name} has a hot shard — skewed key distribution.`,
          why: 'keyDistribution = zipfian and one shard is running well above its peers.',
          useWhen:
            'Pick a higher-cardinality shard key, salt the hot key, or use consistent hashing with virtual nodes to spread it.',
          severity: 'warn',
          docHref: `${DOC}#sharding`,
        });
      }
    }

    // --- Caching --------------------------------------------------------
    const cacheUpstream = hasUpstream(adj, db.id, new Set(['cache', 'cdn']));
    if ((m?.overloaded || (m?.rho ?? 0) >= 0.8) && !cacheUpstream) {
      out.push({
        topic: 'Caching',
        verdict: `${name} is hot with no cache in front of it.`,
        why: `ρ ≈ ${(m?.rho ?? 0).toFixed(2)} and no cache/CDN on any path into it.`,
        useWhen:
          'Cache-aside for read-heavy data that tolerates a short TTL; write-through when reads must be fresh. Add jitter / a lock to avoid a stampede on expiry.',
        severity: 'warn',
        docHref: `${DOC}#caching`,
      });
    }
  }

  // --- Load-balancer algorithm ---------------------------------------
  for (const lb of design.nodes.filter((n) => n.type === 'loadBalancer')) {
    const algo = strOr(lb.params.algorithm, 'round-robin');
    const hint =
      algo === 'round-robin'
        ? 'Round-robin is fine for uniform request cost; switch to least-conn if some requests are much heavier than others.'
        : algo === 'least-conn'
          ? 'Least-conn suits variable request cost; round-robin is cheaper when work is uniform.'
          : 'Random (power-of-two-choices) scales to very large fleets where tracking connection counts is expensive.';
    out.push({
      topic: 'Load balancing',
      verdict: `${lbl(lb)} uses ${algo}.`,
      why: 'Backend-selection policy set on the load balancer.',
      useWhen: hint,
      severity: 'info',
      docHref: `${DOC}#load-balancing`,
    });
  }

  // --- Reverse proxy in front of the app tier -----------------------
  for (const app of apps) {
    if (!hasUpstream(adj, app.id, new Set(['loadBalancer', 'cdn', 'apiGateway']))) {
      out.push({
        topic: 'Reverse proxy',
        verdict: `${lbl(app)} has no reverse proxy in front of it.`,
        why: 'No load balancer or CDN upstream of the app tier.',
        useWhen:
          'Put a reverse proxy in front for TLS termination, health checks, caching, rate-limiting and request fan-out. (A forward proxy is an egress concern — different tool.)',
        severity: 'warn',
        docHref: `${DOC}#proxies`,
      });
      break; // one note is enough
    }
  }

  // --- Queue backpressure -----------------------------------------
  for (const e of design.edges) {
    const src = adj.byId.get(e.source);
    const tgt = adj.byId.get(e.target);
    if (src?.type === 'queue' && tgt?.type === 'worker' && metricsOf(tgt.id)?.overloaded) {
      out.push({
        topic: 'Backpressure',
        verdict: `${lbl(tgt)} can't drain ${lbl(src)} — the backlog is growing.`,
        why: 'Consumer is saturated while the queue keeps accepting work.',
        useWhen:
          'The queue smooths bursts, it does not add capacity — add workers, shard the topic for more consumer parallelism, or shed / DLQ the overflow.',
        severity: 'warn',
        docHref: `${DOC}#backpressure`,
      });
    }
  }

  // --- Resilience: third party without a breaker -----------------
  for (const ext of externals) {
    const guarded = hasUpstream(adj, ext.id, new Set(['circuitBreaker']));
    if (!guarded) {
      out.push({
        topic: 'Resilience',
        verdict: `${lbl(ext)} is called with no circuit breaker in front.`,
        why: 'A third-party dependency on the request path, unguarded.',
        useWhen:
          'Wrap a flaky or slow dependency in a circuit breaker (and set a timeout on the edge) so it fast-fails instead of tying up your workers.',
        severity: 'warn',
        docHref: `${DOC}#circuit-breakers`,
      });
    }
  }

  const rank = { warn: 0, note: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
