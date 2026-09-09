import { describe, expect, it } from 'vitest';
import { Simulator } from './simulator';
import { solve } from '../solver';
import type { EdgeSpec, NodeSpec, SystemDesign } from '../types';

function node(id: string, type: NodeSpec['type'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, type, position: { x: 0, y: 0 }, label: id, params };
}
function edge(id: string, source: string, target: string, params: EdgeSpec['params'] = {}): EdgeSpec {
  return { id, source, target, params };
}
function design(nodes: NodeSpec[], edges: EdgeSpec[], targetRps: number): SystemDesign {
  return {
    version: 1,
    name: 'conv',
    nodes,
    edges,
    sim: { scenario: { kind: 'constant', targetRps, durationSec: 1e6 }, seed: 7, speed: 1 },
  };
}

function closedLoop(
  nodes: NodeSpec[],
  edges: EdgeSpec[],
  users: number,
  thinkTimeSec: number,
): SystemDesign {
  return {
    version: 1,
    name: 'closed',
    nodes,
    edges,
    sim: {
      scenario: { kind: 'constant', mode: 'users', targetRps: 0, users, thinkTimeSec, durationSec: 1e6 },
      seed: 7,
      speed: 1,
    },
  };
}

/** Warm up to steady state, discard, then measure over a window. */
function measure(d: SystemDesign, warmupSec: number, measureSec: number) {
  const sim = new Simulator(d);
  expect(sim.valid).toBe(true);
  sim.advance(warmupSec);
  sim.snapshot();
  sim.advance(warmupSec + measureSec);
  return sim.snapshot();
}

function rel(got: number, want: number): number {
  if (!Number.isFinite(got) || !Number.isFinite(want)) return got === want ? 0 : 1;
  if (want === 0) return Math.abs(got);
  return Math.abs(got - want) / Math.abs(want);
}

describe('DES ↔ analytical convergence (stationary load)', () => {
  it('M/M/c app server: ρ, latency and drop rate track the analytical model', () => {
    const d = design(
      [
        node('c', 'client'),
        // μ = 200/s per slot, c = 4 → capacity 800/s
        node('s', 'apiServer', {
          serviceTimeMs: 5,
          concurrency: 4,
          replicas: 1,
          intrinsicErrorRate: 0,
        }),
        node('db', 'sqlDatabase', { queryTimeMs: 0.5, poolSize: 200, intrinsicErrorRate: 0 }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
      520, // ρ ≈ 0.65
    );
    const sim = measure(d, 120, 400);
    const a = solve(d).perNode.s.metrics;
    const s = sim.perNode.s;

    expect(Math.abs(s.rho - a.rho)).toBeLessThan(0.05);
    expect(s.dropRate).toBeLessThan(0.01);
    expect(rel(s.arrivalRate, a.arrivalRate)).toBeLessThan(0.06);
    expect(rel(s.latency.p50, a.latency.p50)).toBeLessThan(0.25);
    expect(rel(s.latency.p99, a.latency.p99)).toBeLessThan(0.3);
  });

  it('M/M/1 load balancer: utilization and mean latency track the analytical model', () => {
    const d = design(
      [
        node('c', 'client'),
        node('lb', 'loadBalancer', { capacityRps: 500, latencyMs: 1 }),
        node('s', 'apiServer', {
          serviceTimeMs: 0.5,
          concurrency: 64,
          replicas: 1,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 'lb'), edge('e2', 'lb', 's')],
      350, // lb ρ = 0.7
    );
    const sim = measure(d, 100, 400);
    const a = solve(d).perNode.lb.metrics;
    expect(Math.abs(sim.perNode.lb.rho - a.rho)).toBeLessThan(0.05);
    expect(rel(sim.perNode.lb.latency.mean, a.latency.mean)).toBeLessThan(0.3);
  });

  it('cache hit ratio governs the load that reaches the origin', () => {
    const d = design(
      [
        node('c', 'client'),
        node('k', 'cache', { hitRatio: 0.75, capacityRps: 100000, intrinsicErrorRate: 0 }),
        node('db', 'sqlDatabase', { queryTimeMs: 1, poolSize: 100, intrinsicErrorRate: 0 }),
      ],
      [edge('e1', 'c', 'k'), edge('e2', 'k', 'db')],
      600,
    );
    const sim = measure(d, 80, 300);
    expect(rel(sim.perNode.db.arrivalRate, 150)).toBeLessThan(0.1); // ~25% of 600
  });

  it('closed loop: DES effective rate matches the interactive law λ = N/(R+Z)', () => {
    const nodes = [
      node('c', 'client'),
      node('s', 'apiServer', {
        serviceTimeMs: 10,
        concurrency: 8,
        replicas: 1,
        intrinsicErrorRate: 0,
      }),
      node('db', 'sqlDatabase', { queryTimeMs: 1, poolSize: 200, intrinsicErrorRate: 0 }),
    ];
    const edges = [edge('e1', 'c', 's'), edge('e2', 's', 'db')];
    const d = closedLoop(nodes, edges, 300, 1);

    const sim = measure(d, 80, 300);
    const an = solve(d);

    // both should sit a little below the naive 300 rps (R > 0)
    expect(an.system.offeredRps).toBeGreaterThan(250);
    expect(an.system.offeredRps).toBeLessThan(300);
    expect(rel(sim.system.offeredRps, an.system.offeredRps)).toBeLessThan(0.08);
  });

  it('closed loop: throughput plateaus as users pile up past capacity', () => {
    const mk = (users: number) =>
      closedLoop(
        [
          node('c', 'client'),
          node('s', 'apiServer', {
            serviceTimeMs: 10,
            concurrency: 1,
            replicas: 1,
            intrinsicErrorRate: 0,
          }),
          node('db', 'sqlDatabase', { queryTimeMs: 0.5, poolSize: 100, intrinsicErrorRate: 0 }),
        ],
        [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
        users,
        1,
      );

    const a200 = solve(mk(200));
    const a800 = solve(mk(800));
    // capacity is ~100 rps; 4× the users barely moves throughput...
    expect(a800.system.servedRps).toBeLessThan(a200.system.servedRps * 1.25);
    // ...but response time climbs...
    expect(a800.system.latency.mean).toBeGreaterThan(a200.system.latency.mean * 1.5);
    // ...and a far larger share of requests is shed
    expect(a800.system.successRate).toBeLessThan(a200.system.successRate * 0.7);
  });

  it('retries amplify edge flow toward a failing dependency', () => {
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', {
          serviceTimeMs: 0.5,
          concurrency: 128,
          replicas: 1,
          intrinsicErrorRate: 0,
        }),
        node('db', 'sqlDatabase', {
          queryTimeMs: 15,
          poolSize: 1,
          queueLimit: 1,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'db', { retries: 3 })],
      150,
    );
    const sim = measure(d, 60, 200);
    expect(sim.perEdge.e2.retryFactor).toBeGreaterThan(1.3);
    expect(sim.perNode.db.dropRate).toBeGreaterThan(0.3);
  });

  it('per-attempt timeout: DES timeout rate and success rate track the analytical tail', () => {
    // DB sojourn ≈ Exp(50 ms) at negligible utilization; a 50 ms timeout clips
    // the tail at P(sojourn > 50 ms) = e^-1 ≈ 0.368. No retries → a timeout is a
    // failed request, so end-to-end success ≈ 1 − 0.368.
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', {
          serviceTimeMs: 0.5,
          concurrency: 128,
          replicas: 1,
          intrinsicErrorRate: 0,
        }),
        node('db', 'sqlDatabase', {
          queryTimeMs: 50,
          poolSize: 64,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'db', { timeoutSec: 0.05 })],
      100,
    );
    const sim = measure(d, 120, 600);
    const a = solve(d);

    expect(a.perEdge.e2.timeoutRate).toBeGreaterThan(0.3);
    expect(sim.perEdge.e2.timeoutRate).toBeGreaterThan(0.25);
    expect(rel(sim.perEdge.e2.timeoutRate, a.perEdge.e2.timeoutRate)).toBeLessThan(0.2);
    expect(rel(sim.system.successRate, a.system.successRate)).toBeLessThan(0.15);
  });

  it('per-edge network latency adds a fixed hop delay to end-to-end p99', () => {
    const mk = (netLatencyMs: number) =>
      design(
        [
          node('c', 'client'),
          node('s', 'apiServer', {
            serviceTimeMs: 2,
            concurrency: 64,
            replicas: 1,
            intrinsicErrorRate: 0,
          }),
          node('db', 'sqlDatabase', { queryTimeMs: 2, poolSize: 64, intrinsicErrorRate: 0 }),
        ],
        [edge('e1', 'c', 's'), edge('e2', 's', 'db', { netLatencyMs })],
        200,
      );
    const near = measure(mk(0), 60, 300);
    const far = measure(mk(40), 60, 300);
    const aNear = solve(mk(0));
    const aFar = solve(mk(40));

    // analytical: the 40 ms hop shows up once on the critical path
    expect((aFar.system.latency.p99 - aNear.system.latency.p99) * 1000).toBeCloseTo(40, 0);
    expect(aFar.perEdge.e2.netLatencySec).toBeCloseTo(0.04, 6);

    // DES agrees within a few ms of jitter
    const desDelta = (far.system.latency.p99 - near.system.latency.p99) * 1000;
    expect(desDelta).toBeGreaterThan(30);
    expect(desDelta).toBeLessThan(55);
  });

  it('database engine type: a throughput-bound write-heavy store tracks between engines', () => {
    // Cassandra: writes ~2.5× cheaper than reads, sized on capacityRps not a pool.
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', {
          serviceTimeMs: 0.5,
          concurrency: 128,
          replicas: 1,
          intrinsicErrorRate: 0,
        }),
        node('db', 'sqlDatabase', {
          architecture: 'single',
          engine: 'cassandra',
          capacityRps: 800,
          queryTimeMs: 1,
          readRatio: 0.2,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'db')],
      500,
    );
    const sim = measure(d, 120, 400);
    const a = solve(d).perNode.db.metrics;
    const s = sim.perNode.db;

    // write-heavy mix on an LSM store stays well under capacity in both engines
    expect(a.rho).toBeLessThan(0.85);
    expect(Math.abs(s.rho - a.rho)).toBeLessThan(0.08);
    expect(rel(s.latency.p50, a.latency.p50)).toBeLessThan(0.35);
  });

  it('circuit breaker: trips OPEN and shields the dependency in both engines', () => {
    // DB errors intrinsically at 70% — above the breaker's 50% trip threshold.
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', {
          serviceTimeMs: 0.5,
          concurrency: 128,
          replicas: 1,
          intrinsicErrorRate: 0,
        }),
        node('cb', 'circuitBreaker', {
          errorThresholdPct: 50,
          windowSec: 10,
          cooldownSec: 30,
          fastFailMs: 1,
        }),
        node('db', 'sqlDatabase', {
          architecture: 'single',
          queryTimeMs: 1,
          poolSize: 200,
          intrinsicErrorRate: 0.7,
        }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'cb'), edge('e3', 'cb', 'db')],
      400,
    );
    const sim = measure(d, 300, 2400);
    const a = solve(d);

    // both engines settle with the breaker OPEN against the failing dependency
    expect(a.perNode.cb.metrics.breakerState).toBe('open');
    expect(sim.perNode.cb.breakerState).toBe('open');

    // both shield the dependency hard — it sees only a small slice of the load.
    // (The exact open↔probe↔close duty cycle is a chaotic process, so the two
    // engines agree on "mostly open", not to the last percent.)
    const aOpen = 1 - a.perNode.db.metrics.arrivalRate / 400;
    const sOpen = 1 - sim.perNode.db.arrivalRate / 400;
    expect(aOpen).toBeGreaterThan(0.85);
    expect(sOpen).toBeGreaterThan(0.85);
    expect(Math.abs(aOpen - sOpen)).toBeLessThan(0.15);

    // end-to-end success collapses to the fast-fail floor in both engines
    expect(a.system.successRate).toBeLessThan(0.12);
    expect(sim.system.successRate).toBeLessThan(0.12);
  });

  it('API gateway: the rate limit admits the same rate and 429s the rest in both engines', () => {
    // 600 req/s offered, 240 req/s rate limit → ~60% come back 429.
    const d = design(
      [
        node('c', 'client'),
        node('gw', 'apiGateway', { capacityRps: 50000, instances: 1, rateLimitRps: 240, authLatencyMs: 2, authErrorRate: 0 }),
        node('s', 'apiServer', { serviceTimeMs: 1, concurrency: 128, replicas: 1, intrinsicErrorRate: 0 }),
      ],
      [edge('e1', 'c', 'gw'), edge('e2', 'gw', 's')],
      600,
    );
    const sim = measure(d, 200, 1200);
    const a = solve(d);

    // backend sees only the admitted rate in both engines
    expect(a.perNode.s.metrics.arrivalRate).toBeLessThan(280);
    expect(rel(sim.perNode.s.arrivalRate, a.perNode.s.metrics.arrivalRate)).toBeLessThan(0.15);

    // ~60% shed as 429 at the gateway
    expect(a.perNode.gw.metrics.dropRate).toBeCloseTo(1 - 240 / 600, 2);
    expect(Math.abs(sim.perNode.gw.dropRate - a.perNode.gw.metrics.dropRate)).toBeLessThan(0.08);
  });

  it('identity provider: session-cache blended service tracks between engines', () => {
    const d = design(
      [
        node('c', 'client'),
        node('gw', 'apiGateway', { capacityRps: 50000, rateLimitRps: 50000, authLatencyMs: 1, authErrorRate: 0 }),
        node('idp', 'identityProvider', {
          introspectMs: 8,
          tokenIssueMs: 25,
          issueRatio: 0.15,
          sessionCacheHitRatio: 0.6,
          poolSize: 32,
          providerErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 'gw'), edge('e2', 'gw', 'idp')],
      3000,
    );
    const sim = measure(d, 120, 400);
    const a = solve(d).perNode.idp.metrics;
    const s = sim.perNode.idp;
    expect(a.rho).toBeGreaterThan(0.3);
    expect(a.rho).toBeLessThan(0.85);
    expect(Math.abs(s.rho - a.rho)).toBeLessThan(0.08);
    expect(rel(s.latency.mean, a.latency.mean)).toBeLessThan(0.25);
  });

  it('coordination service: quorum-write blend tracks between engines', () => {
    // 5-node ensemble, 40% writes → each write waits for 3 acks; poolSize 32.
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', { serviceTimeMs: 0.5, concurrency: 128, replicas: 1, intrinsicErrorRate: 0 }),
        node('zk', 'coordination', {
          ensembleSize: 5,
          opLatencyMs: 2,
          writeQuorumMs: 6,
          readRatio: 0.6,
          watchClients: 1000,
          poolSize: 32,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'zk')],
      1500,
    );
    const sim = measure(d, 120, 400);
    const a = solve(d).perNode.zk.metrics;
    const s = sim.perNode.zk;
    expect(a.rho).toBeGreaterThan(0.35);
    expect(a.rho).toBeLessThan(0.85);
    expect(Math.abs(s.rho - a.rho)).toBeLessThan(0.08);
    expect(rel(s.latency.mean, a.latency.mean)).toBeLessThan(0.25);
  });

  it('stream processor: parallelism + amortised checkpoint latency track between engines', () => {
    // 4 slots · 4 ms/record (heap) ⇒ 1000 rec/s; 400 ms stall / 20 s ⇒ ~8 ms
    // amortised on every record.
    const d = design(
      [
        node('c', 'client'),
        node('t', 'pubsubTopic', { throughputRps: 100000 }),
        node('sp', 'streamProcessor', {
          recordServiceMs: 4,
          parallelism: 4,
          stateBackend: 'heap',
          stateGB: 1,
          checkpointSec: 20,
          checkpointStallMs: 400,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 't'), edge('e2', 't', 'sp')],
      600,
    );
    const sim = measure(d, 120, 500);
    const a = solve(d).perNode.sp.metrics;
    const s = sim.perNode.sp;
    expect(a.rho).toBeGreaterThan(0.45);
    expect(a.rho).toBeLessThan(0.75);
    expect(Math.abs(s.rho - a.rho)).toBeLessThan(0.08);
    // mean carries the ~8 ms checkpoint amortisation in both engines
    expect(a.latency.mean).toBeGreaterThan(0.01);
    expect(rel(s.latency.mean, a.latency.mean)).toBeLessThan(0.3);
  });

  it('vector DB: HNSW query slots track between engines', () => {
    // HNSW ~4 ms/op, 4 slots ⇒ ~1000 ops/s; offer 600 ⇒ ρ ≈ 0.6.
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', { serviceTimeMs: 0.5, concurrency: 128, replicas: 1, intrinsicErrorRate: 0 }),
        node('v', 'vectorDb', {
          indexType: 'hnsw',
          queryTimeMs: 4,
          dimensions: 768,
          vectorCount: 2_000_000,
          ramGB: 32,
          writeRatio: 0.1,
          poolSize: 4,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'v')],
      600,
    );
    const sim = measure(d, 120, 500);
    const a = solve(d).perNode.v.metrics;
    const s = sim.perNode.v;
    expect(a.rho).toBeGreaterThan(0.45);
    expect(a.rho).toBeLessThan(0.75);
    expect(Math.abs(s.rho - a.rho)).toBeLessThan(0.08);
    expect(rel(s.latency.p50, a.latency.p50)).toBeLessThan(0.3);
  });

  it('data warehouse: slot-bound M/M/c/K at second-scale service tracks between engines', () => {
    // 8 slots · 2 s scans ⇒ 4 queries/s capacity; offer 2.5 ⇒ ρ ≈ 0.625.
    const d = design(
      [
        node('c', 'client'),
        node('bi', 'apiServer', { serviceTimeMs: 0.5, concurrency: 64, replicas: 1, intrinsicErrorRate: 0 }),
        node('dw', 'analyticsDb', {
          scanTimeSec: 2,
          concurrencySlots: 8,
          resultCacheHitRatio: 0,
          queueOnFull: true,
          queueLimit: 50,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 'bi'), edge('e2', 'bi', 'dw')],
      2.5,
    );
    const sim = measure(d, 400, 3000);
    const a = solve(d).perNode.dw.metrics;
    const s = sim.perNode.dw;
    expect(a.rho).toBeGreaterThan(0.5);
    expect(a.rho).toBeLessThan(0.75);
    expect(Math.abs(s.rho - a.rho)).toBeLessThan(0.1);
    expect(rel(s.latency.mean, a.latency.mean)).toBeLessThan(0.25);
  });

  it('search cluster: aggregate ρ and latency track between engines at low load', () => {
    // uniform keys, lightly loaded — scatter-gather ≈ a single shard service, so
    // the per-shard analytical model and the DES aggregate station agree.
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', { serviceTimeMs: 0.5, concurrency: 128, replicas: 1, intrinsicErrorRate: 0 }),
        node('es', 'searchIndex', {
          shards: 4,
          replicas: 1,
          queryTimeMs: 40,
          poolSize: 20,
          readRatio: 1,
          refreshIntervalSec: 1,
          coordinatorMs: 2,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'es')],
      500,
    );
    const sim = measure(d, 120, 500);
    const a = solve(d).perNode.es.metrics;
    const s = sim.perNode.es;
    // both engines see a lightly-loaded cluster (they scale ρ differently — the
    // analytical model is per-shard, the DES aggregates slots — so just check
    // both are comfortably under load)…
    expect(a.rho).toBeLessThan(0.4);
    expect(s.rho).toBeLessThan(0.4);
    // …and the query latency (service + coordinator, no queueing) agrees
    expect(rel(s.latency.mean, a.latency.mean)).toBeLessThan(0.25);
  });

  it('serverless: cold-start latency and concurrency throttling track between engines', () => {
    // ~30 ms warm + 20% cold at +200 ms ⇒ ~70 ms effective; 300 req/s × 70 ms
    // ⇒ ~21 concurrent, a hair under the 24 ceiling → a little throttling.
    const d = design(
      [
        node('c', 'client'),
        node('s', 'apiServer', { serviceTimeMs: 0.5, concurrency: 128, replicas: 1, intrinsicErrorRate: 0 }),
        node('fn', 'serverlessFn', {
          execTimeMs: 30,
          coldStartMs: 200,
          coldStartRate: 0.2,
          maxConcurrency: 24,
          intrinsicErrorRate: 0,
        }),
      ],
      [edge('e1', 'c', 's'), edge('e2', 's', 'fn')],
      300,
    );
    const sim = measure(d, 150, 900);
    const a = solve(d).perNode.fn.metrics;
    const s = sim.perNode.fn;

    // effective service time ≈ 70 ms in both engines
    expect(rel(s.latency.mean, a.latency.mean)).toBeLessThan(0.2);
    // both throttle a similar slice
    expect(a.dropRate).toBeGreaterThan(0.03);
    expect(Math.abs(s.dropRate - a.dropRate)).toBeLessThan(0.08);
  });

  it('DB proxy: pooler utilization and connection-exhaustion drops track between engines', () => {
    // 4 backend conns · (1000/8 ms) = 500 req/s capacity; offer 300 → ρ ≈ 0.6.
    const d = design(
      [
        node('c', 'client'),
        node('p', 'dbProxy', { backendConns: 4, avgHoldMs: 8, poolMode: 'transaction', queueDepth: 200, proxyLatencyMs: 0.5 }),
        node('db', 'sqlDatabase', { architecture: 'single', queryTimeMs: 8, poolSize: 400, intrinsicErrorRate: 0 }),
      ],
      [edge('e1', 'c', 'p'), edge('e2', 'p', 'db')],
      300,
    );
    const sim = measure(d, 150, 1000);
    const a = solve(d);
    expect(a.perNode.p.metrics.rho).toBeGreaterThan(0.45);
    expect(a.perNode.p.metrics.rho).toBeLessThan(0.8);
    expect(Math.abs(sim.perNode.p.rho - a.perNode.p.metrics.rho)).toBeLessThan(0.1);
    expect(Math.abs(sim.perNode.p.dropRate - a.perNode.p.metrics.dropRate)).toBeLessThan(0.05);
  });
});
