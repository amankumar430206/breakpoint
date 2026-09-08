import {
  mulberry32,
  type ComponentType,
  type EdgeSpec,
  type NodeSpec,
  type ScenarioConfig,
  type SimConfig,
  type SystemDesign,
} from '@/engine';

/** Just the scenario knobs (load, kind, peak, duration, speed, seed), randomised
 *  — for the "🎲" in the scenario bar that keeps the current design. */
export function randomScenario(seed: number = (Math.random() * 1e9) >>> 0): SimConfig {
  const rng = mulberry32(seed >>> 0);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng.next() * a.length)];
  const usersMode = rng.next() < 0.6;
  const level = pick([200, 500, 1000, 3000, 8000, 20000, 60000]);
  const scenario: ScenarioConfig = {
    kind: pick(['constant', 'constant', 'ramp', 'diurnal', 'spike', 'thunderingHerd'] as const),
    mode: usersMode ? 'users' : 'rps',
    targetRps: level,
    users: level,
    thinkTimeSec: pick([0.5, 1, 1, 2, 5]),
    durationSec: pick([60, 120, 180]),
    peakFactor: Number((2 + rng.next() * 10).toFixed(1)),
  };
  return { scenario, seed: 1 + Math.floor(rng.next() * 9998), speed: pick([2, 4, 8]) };
}

/**
 * Build a random-but-plausible system + scenario, so you can sanity-check how
 * the tool (and the design idioms) behave under an arbitrary shape. Seeded, so
 * the same seed reproduces the same design.
 */
export function randomDesign(seed: number = (Math.random() * 1e9) >>> 0): SystemDesign {
  const rng = mulberry32(seed >>> 0);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng.next() * a.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rng.next() * (hi - lo + 1));
  const chance = (p: number) => rng.next() < p;

  const nodes: NodeSpec[] = [];
  const edges: EdgeSpec[] = [];
  let row = 0;

  const node = (
    type: ComponentType,
    label: string,
    params: Record<string, unknown>,
    col = 0,
  ): string => {
    const id = `${type}_${nodes.length}`;
    nodes.push({ id, type, position: { x: 320 + col * 230, y: row * 150 }, label, params });
    return id;
  };
  const link = (from: string, to: string, params: EdgeSpec['params'] = {}) =>
    edges.push({ id: `e${edges.length}`, source: from, target: to, params });

  // ── traffic + edge ────────────────────────────────────────────────────────
  const client = node('client', 'Users', {});
  row++;
  let head = client;

  if (chance(0.45)) {
    const cdn = node('cdn', 'CDN', { offloadRatio: Number((0.5 + rng.next() * 0.45).toFixed(2)) });
    link(head, cdn);
    head = cdn;
    row++;
  }

  const lb = node('loadBalancer', pick(['ALB', 'Envoy', 'API gateway']), {
    capacityRps: int(15000, 120000),
    ...(chance(0.25) ? { capacityRps: int(1000, 4000) } : {}), // sometimes a throttling gateway
  });
  link(head, lb);
  head = lb;
  row++;

  // ── app tier (maybe fanned out) ───────────────────────────────────────────
  const fanout = pick([1, 1, 1, 2, 3]);
  const appParams = () => ({
    serviceTimeMs: int(5, 55),
    vcpus: pick([1, 2, 4, 8]),
    ramGB: pick([2, 4, 8, 16]),
    replicas: int(1, 4),
    memPerReqMB: pick([20, 40, 80]),
  });
  const apps: string[] = [];
  for (let i = 0; i < fanout; i++) {
    const a = node('apiServer', fanout > 1 ? `svc-${i + 1}` : 'app-svc', appParams(), i - (fanout - 1) / 2);
    link(lb, a);
    apps.push(a);
  }
  row++;

  // ── data / async / third-party downstream ────────────────────────────────
  const flavor = pick(['cache-db', 'cache-db', 'queue-worker', 'third-party', 'sharded']);
  const arch = pick(['single', 'primary-replica', 'primary-replica', 'multi-primary', 'sharded']);
  const dbParams = {
    architecture: flavor === 'sharded' ? 'sharded' : arch,
    queryTimeMs: int(3, 20),
    poolSize: int(8, 40),
    readRatio: Number((0.5 + rng.next() * 0.45).toFixed(2)),
    readReplicas: int(0, 3),
    primaries: int(2, 5),
    shards: pick([2, 4, 8]),
    keyDistribution: pick(['uniform', 'uniform', 'zipfian']),
  };

  const eff = apps.length > 1 ? pick(['cache-db', 'sharded'] as const) : flavor;

  if (eff === 'queue-worker') {
    const cache = node('cache', 'Cache', { hitRatio: Number((0.6 + rng.next() * 0.38).toFixed(2)) }, -1);
    const q = node('queue', 'events', { brokerThroughputRps: int(20000, 80000) }, 1);
    for (const a of apps) {
      link(a, cache, { retries: chance(0.4) ? 1 : 0 });
      link(a, q);
    }
    row++;
    const w = node('worker', 'worker', { jobTimeMs: int(30, 400), vcpus: pick([2, 4]), replicas: int(1, 4) }, 1);
    const db = node('sqlDatabase', 'Postgres', dbParams, -1);
    link(q, w);
    link(cache, db);
    link(w, db);
  } else if (eff === 'third-party') {
    const db = node('sqlDatabase', 'Postgres', dbParams, -1);
    const ext = node('externalService', pick(['Stripe', 'Twilio', 'SendGrid', 'Partner API']), {
      latencyMs: int(80, 400),
      jitterMs: int(40, 200),
      rateLimitRps: pick([200, 500, 1000, 3000]),
      errorRate: Number((rng.next() * 0.03).toFixed(3)),
    }, 1);
    for (const a of apps) {
      link(a, db, { retries: 1 });
      link(a, ext, { retries: int(0, 3), timeoutSec: pick([1, 2, 3, 5]) });
    }
  } else {
    // cache-db or sharded
    const cache = eff === 'sharded' || chance(0.2) ? null : node('cache', 'Cache', { hitRatio: Number((0.55 + rng.next() * 0.4).toFixed(2)) }, 0);
    if (cache) row++;
    const db = node(
      'sqlDatabase',
      eff === 'sharded' ? 'DB (sharded)' : 'Postgres',
      eff === 'sharded' ? { ...dbParams, architecture: 'sharded' } : dbParams,
      0,
    );
    for (const a of apps) link(a, cache ?? db, { retries: chance(0.3) ? 1 : 0 });
    if (cache) link(cache, db, { retries: chance(0.4) ? 2 : 0 });
  }
  row++;

  const adj = pick(['Nimble', 'Rickety', 'Overbuilt', 'Frugal', 'Sprawling', 'Lean', 'Baroque']);
  const noun = pick(['pipeline', 'stack', 'mesh', 'monolith', 'cluster', 'fabric']);

  return {
    version: 1,
    name: `${adj} ${noun} #${seed % 10000}`,
    description: 'Randomly generated — press Play and see how it holds up.',
    nodes,
    edges,
    sim: randomScenario(seed ^ 0x9e3779b9),
  };
}
