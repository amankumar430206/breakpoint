import type { SystemDesign } from '@/engine';

/**
 * The system that runs live in the hero demo. Deliberately small (6 boxes) so
 * the animation reads at a glance, but wired like a real read-heavy web tier:
 * CDN in front, a load balancer fanning to three app servers, a Redis look-aside
 * cache, and Postgres (primary + one read replica) behind a small connection
 * pool. Under the scripted spike the pool saturates first — the classic
 * "why did removing the cache melt the DB" story, emergent from the numbers.
 *
 * `targetRps` is rewritten every tick by the engine loop; everything else is
 * the shape the "Open this in the canvas" button hands to the sandbox verbatim.
 */
export const DEMO_DESIGN: SystemDesign = {
  version: 1,
  name: 'Read-heavy web tier (live demo)',
  description:
    'The system from the breakpoint landing page: CDN → load balancer → 3 app servers → Redis cache + Postgres (primary/replica) behind a pool. Push the load up and watch the pool saturate.',
  nodes: [
    { id: 'client', type: 'client', position: { x: 0, y: 150 }, label: 'Visitors', params: {} },
    {
      id: 'cdn',
      type: 'cdn',
      position: { x: 190, y: 150 },
      label: 'CDN',
      params: { offloadRatio: 0.55, edgeLatencyMs: 10 },
    },
    {
      id: 'lb',
      type: 'loadBalancer',
      position: { x: 380, y: 150 },
      label: 'Load balancer',
      params: { capacityRps: 200000 },
    },
    {
      id: 'api',
      type: 'apiServer',
      position: { x: 585, y: 150 },
      label: 'app server',
      params: { serviceTimeMs: 9, vcpus: 8, ramGB: 16, replicas: 3, queriesPerRequest: 4 },
    },
    {
      id: 'redis',
      type: 'cache',
      position: { x: 820, y: 40 },
      label: 'Redis',
      params: { hitRatio: 0.82, hitLatencyMs: 1 },
    },
    {
      id: 'pool',
      type: 'dbProxy',
      position: { x: 820, y: 210 },
      label: 'PgBouncer',
      params: { backendConns: 32, avgHoldMs: 9, poolMode: 'transaction', queueDepth: 800 },
    },
    {
      id: 'pg',
      type: 'sqlDatabase',
      position: { x: 1010, y: 210 },
      label: 'Postgres',
      params: {
        architecture: 'primary-replica',
        engine: 'postgres',
        queryTimeMs: 7,
        poolSize: 32,
        readReplicas: 1,
        readRatio: 0.85,
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'client', target: 'cdn', params: {} },
    { id: 'e2', source: 'cdn', target: 'lb', params: {} },
    { id: 'e3', source: 'lb', target: 'api', params: {} },
    { id: 'e4', source: 'api', target: 'redis', params: {} },
    { id: 'e5', source: 'api', target: 'pool', params: { retries: 1, timeoutSec: 2 } },
    { id: 'e6', source: 'pool', target: 'pg', params: {} },
  ],
  sim: {
    scenario: {
      kind: 'constant',
      mode: 'rps',
      targetRps: 2000,
      durationSec: 120,
      peakFactor: 6,
    },
    seed: 7,
    speed: 4,
  },
};
