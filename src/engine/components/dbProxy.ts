import { z } from 'zod';
import { mmck } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { num, str, type ComponentModel } from './types';

/**
 * Database connection pooler / proxy — PgBouncer, RDS Proxy, ProxySQL. Thousands
 * of application connections land here; only `backendConns` are ever open to the
 * real database. Requests that arrive when all backend connections are busy wait
 * (up to `queueDepth`) or get a "too many connections" error.
 *
 * Modelled as an M/M/c/K queue with `c = backendConns` in front of the DB — so
 * the database downstream sees at most `backendConns` concurrent work and its own
 * pool pressure drops. `poolMode` sets how aggressively connections are recycled:
 * `transaction` (default) returns a connection between transactions, `session`
 * holds it for the whole client session (far less multiplexing), `statement`
 * recycles per statement (the most).
 */
const HOLD_FACTOR: Record<string, number> = { session: 3, transaction: 1, statement: 0.5 };

export const dbProxyModel: ComponentModel = {
  type: 'dbProxy',
  label: 'DB Proxy / Pooler',
  category: 'network',
  routing: 'passthrough',
  handles: { in: true, out: true },
  defaultParams: {
    backendConns: 20,
    avgHoldMs: 5,
    poolMode: 'transaction',
    queueDepth: 500,
    proxyLatencyMs: 0.5,
  },
  paramSchema: z.object({
    backendConns: z.number().int().positive().max(10000).default(20),
    avgHoldMs: z.number().positive().max(60000).default(5),
    poolMode: z.enum(['session', 'transaction', 'statement']).default('transaction'),
    queueDepth: z.number().int().nonnegative().max(200000).default(500),
    proxyLatencyMs: z.number().nonnegative().max(1000).default(0.5),
  }),
  paramDocs: {
    backendConns: 'Connections the pooler keeps open to the database — the real concurrency ceiling.',
    avgHoldMs: 'Mean time a backend connection is held per request (≈ the downstream query time).',
    poolMode: 'session = hold for the whole client session; transaction = release between txns; statement = release per statement.',
    queueDepth: 'Clients allowed to wait for a free backend connection before erroring.',
    proxyLatencyMs: 'Fixed hop added by the pooler.',
  },

  scaleParam: { key: 'backendConns', label: 'backend conns', min: 1, max: 2000 },

  presetLegend: 'backend connections',
  presets: [
    { label: '10', hint: 'Small pooler in front of a t3.medium DB', patch: { backendConns: 10 } },
    { label: '25', hint: 'PgBouncer default-ish', patch: { backendConns: 25 } },
    { label: '100', hint: 'Large pool, big DB instance', patch: { backendConns: 100 } },
    { label: '400', hint: 'RDS Proxy at scale', patch: { backendConns: 400 } },
  ],

  outflowFraction: (params, ctx) => {
    const inflow = ctx?.inflow ?? 0;
    if (inflow <= 0) return 1;
    return Math.min(1, backendCapacity(params) / inflow);
  },

  simSpec: (params) => {
    const c = Math.max(1, Math.round(num(params, 'backendConns', 20)));
    const holdSec = holdTimeSec(params);
    return {
      servers: c,
      serviceRate: 1 / holdSec,
      queueCap: Math.max(0, Math.round(num(params, 'queueDepth', 500))),
      fixedLatencySec: num(params, 'proxyLatencyMs', 0.5) / 1000,
      errorRate: 0,
      branchProb: 1,
    };
  },

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const c = Math.max(1, Math.round(num(params, 'backendConns', 20)));
    const mu = 1 / holdTimeSec(params);
    const K = c + Math.max(0, Math.round(num(params, 'queueDepth', 500)));
    const qr = mmck(inflow, mu, c, K);
    const base = metricsFromQueue(qr, {
      offered: inflow,
      capacity: c * mu,
      servers: c,
      intrinsicErrorRate: 0,
      downstreamErrorRate,
    });
    const metrics = addLatency(base, num(params, 'proxyLatencyMs', 0.5) / 1000);
    const mode = str(params, 'poolMode', 'transaction');
    return {
      metrics,
      explain: [
        {
          metric: 'rho',
          text: `${c} backend connections at ~${num(params, 'avgHoldMs', 5)} ms hold (${mode} pooling) ⇒ capacity ≈ ${(c * mu).toFixed(0)} req/s, ρ = ${qr.rho.toFixed(3)}. The database downstream never sees more than ${c} concurrent.`,
          formula: 'M/M/c/K, c = backendConns, μ = 1 / (avgHoldMs · modeFactor)',
          dominantTerm: qr.rho > 0.85 ? 'backend connection limit' : 'query hold time',
        },
        {
          metric: 'dropRate',
          text:
            qr.pBlock > 0.001
              ? `${(qr.pBlock * 100).toFixed(1)}% of requests can't get a connection (pool + ${num(params, 'queueDepth', 500)}-deep wait queue full) — "too many connections". Raise backendConns or use a lighter poolMode.`
              : `Wait queue has headroom — no connection-exhaustion errors.`,
        },
      ],
    };
  },
};

const holdTimeSec = (params: Record<string, unknown>): number =>
  (num(params, 'avgHoldMs', 5) / 1000) * (HOLD_FACTOR[str(params, 'poolMode', 'transaction')] ?? 1);

const backendCapacity = (params: Record<string, unknown>): number =>
  Math.max(1, Math.round(num(params, 'backendConns', 20))) / holdTimeSec(params);
