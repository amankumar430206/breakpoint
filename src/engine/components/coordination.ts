import { z } from 'zod';
import { mmc } from '../queueing';
import { metricsFromQueue } from './util';
import type { ExplainNote } from '../types';
import { bool, idleMetrics, num, type ComponentModel } from './types';

/**
 * Coordination service — ZooKeeper / etcd / Consul. A small consensus ensemble
 * for leader election, distributed locks, service discovery and config.
 *
 *  - **reads** are cheap: any node answers a serializable read locally
 *    (`opLatencyMs`). Turn on `linearizableReads` and every read also pays a
 *    quorum round-trip.
 *  - **writes** go through consensus: the leader waits for `⌊N/2⌋+1` acks, so
 *    write latency grows (slowly) with `ensembleSize` and with `watchClients`
 *    (every write notifies all watchers).
 *
 * More ensemble nodes = more fault tolerance but slower writes — the opposite of
 * "scale out".
 */
export const coordinationModel: ComponentModel = {
  type: 'coordination',
  label: 'Coordination Service',
  category: 'data',
  routing: 'sink',
  handles: { in: true, out: false },
  defaultParams: {
    ensembleSize: 3,
    opLatencyMs: 2,
    writeQuorumMs: 4,
    readRatio: 0.9,
    linearizableReads: false,
    watchClients: 1000,
    poolSize: 64,
    intrinsicErrorRate: 0.0005,
  },
  paramSchema: z.object({
    ensembleSize: z.number().int().min(1).max(15).default(3),
    opLatencyMs: z.number().positive().max(10000).default(2),
    writeQuorumMs: z.number().nonnegative().max(10000).default(4),
    readRatio: z.number().min(0).max(1).default(0.9),
    linearizableReads: z.boolean().default(false),
    watchClients: z.number().int().nonnegative().max(10000000).default(1000),
    poolSize: z.number().int().positive().max(10000).default(64),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.0005),
  }),
  paramDocs: {
    ensembleSize: 'Consensus nodes (use an odd number). More = more fault tolerance, slower writes.',
    opLatencyMs: 'Base op time — a local read or one node applying a write.',
    writeQuorumMs: 'Round-trip cost to gather one quorum ack (network + fsync).',
    readRatio: 'Fraction of ops that are reads (config lookups, watches).',
    linearizableReads: 'On: reads also take a quorum round-trip (etcd ReadIndex).',
    watchClients: 'Clients watching for changes — every write notifies all of them.',
    poolSize: 'Concurrent request slots.',
    intrinsicErrorRate: 'Baseline error rate.',
  },
  scaleParam: { key: 'ensembleSize', label: 'ensemble', min: 1, max: 15, step: 2 },

  presetLegend: 'ensemble size (nodes)',
  presets: [
    { label: '3', hint: 'Standard — tolerates 1 failure', patch: { ensembleSize: 3 } },
    { label: '5', hint: 'Tolerates 2 failures', patch: { ensembleSize: 5 } },
    { label: '7', hint: 'Large — tolerates 3, slower writes', patch: { ensembleSize: 7 } },
  ],

  outflowFraction: () => 0,

  simSpec: (params) => ({
    servers: Math.max(1, Math.round(num(params, 'poolSize', 64))),
    serviceRate: 1000 / blendedMs(params),
    queueCap: Infinity,
    fixedLatencySec: 0,
    errorRate: num(params, 'intrinsicErrorRate', 0.0005),
    branchProb: 0,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const pool = Math.max(1, Math.round(num(params, 'poolSize', 64)));
    if (inflow <= 0) return { metrics: idleMetrics(pool), explain: [] };

    const n = Math.max(1, Math.round(num(params, 'ensembleSize', 3)));
    const majority = Math.floor(n / 2) + 1;
    const rr = num(params, 'readRatio', 0.9);
    const rd = readMs(params);
    const wr = writeMs(params);
    const svc = blendedMs(params);
    const mu = 1000 / svc;
    const qr = mmc(inflow, mu, pool);
    const metrics = metricsFromQueue(qr, {
      offered: inflow,
      capacity: pool * mu,
      servers: pool,
      intrinsicErrorRate: num(params, 'intrinsicErrorRate', 0.0005),
      downstreamErrorRate,
    });

    const explain: ExplainNote[] = [
      {
        metric: 'latency.mean',
        text: `Reads ~${rd.toFixed(1)} ms (${bool(params, 'linearizableReads', false) ? 'linearizable — quorum' : 'local'}); writes wait for ${majority}/${n} acks ⇒ ~${wr.toFixed(1)} ms. ${(rr * 100).toFixed(0)}% reads ⇒ ~${svc.toFixed(1)} ms blended.`,
        formula: 'writeMs = opLatencyMs + writeQuorumMs·(1 + log2(majority)) + watchFanout',
        dominantTerm: rr < 0.6 ? 'write consensus' : 'read path',
      },
      {
        metric: 'rho',
        text: `${n}-node ensemble at ρ ${qr.rho.toFixed(3)}. Adding nodes raises fault tolerance but slows every write — coordination stores don't scale writes, they protect them.`,
      },
    ];
    const watchers = num(params, 'watchClients', 1000);
    if (watchers > 20000 && rr < 0.95) {
      explain.push({
        metric: 'latency.mean',
        text: `${watchers.toLocaleString()} watchers — every write fans a notification to all of them (~${(watchers / 10000).toFixed(1)} ms per write). Batch watches or use a pub/sub layer for high fan-out.`,
        dominantTerm: 'watch fan-out',
      });
    }
    return { metrics, explain };
  },
};

function readMs(params: Record<string, unknown>): number {
  const base = Math.max(0.001, num(params, 'opLatencyMs', 2));
  return bool(params, 'linearizableReads', false) ? base + num(params, 'writeQuorumMs', 4) : base;
}
function writeMs(params: Record<string, unknown>): number {
  const n = Math.max(1, Math.round(num(params, 'ensembleSize', 3)));
  const majority = Math.floor(n / 2) + 1;
  const quorum = num(params, 'writeQuorumMs', 4) * (1 + Math.log2(Math.max(1, majority)));
  const watchFanout = num(params, 'watchClients', 1000) / 10000; // ~10 µs per notify
  return num(params, 'opLatencyMs', 2) + quorum + watchFanout;
}
function blendedMs(params: Record<string, unknown>): number {
  const rr = num(params, 'readRatio', 0.9);
  return rr * readMs(params) + (1 - rr) * writeMs(params);
}
