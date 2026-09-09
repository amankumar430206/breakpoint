import { z } from 'zod';
import { idleMetrics, num, type ComponentModel } from './types';

/**
 * Change-data-capture connector — Debezium / Kafka Connect. Taps a datastore's
 * write stream and republishes it as events (usually onto a `pubsubTopic`), a
 * few `lagMs` behind the commit.
 *
 * The request-flow engine is request-path oriented and a datastore is a sink, so
 * a CDC tap is modelled as a `branch` node on the write path: wire it
 * `apiServer → cdcConnector → pubsubTopic` alongside the normal
 * `apiServer → sqlDatabase` edge. `captureRatio` is the fraction of the
 * connector's inflow that is a captured change (set it to your write ratio ×
 * whatever fraction of tables are captured); the rest short-circuits.
 * `lagMs` is the commit-to-topic latency.
 */
export const cdcConnectorModel: ComponentModel = {
  type: 'cdcConnector',
  label: 'CDC Connector',
  category: 'messaging',
  routing: 'branch',
  handles: { in: true, out: true },
  defaultParams: {
    captureRatio: 0.2,
    lagMs: 500,
    maxChangeRps: 100000,
  },
  paramSchema: z.object({
    captureRatio: z.number().min(0).max(1).default(0.2),
    lagMs: z.number().nonnegative().max(600000).default(500),
    maxChangeRps: z.number().positive().max(50000000).default(100000),
  }),
  paramDocs: {
    captureRatio: 'Fraction of inflow that is a captured change (≈ write ratio × captured-table share).',
    lagMs: 'Commit-to-topic lag — how far behind the source the event stream runs.',
    maxChangeRps: 'Changes/sec the connector can ship before it falls behind.',
  },

  presetLegend: 'capture throughput (changes/s)',
  presets: [
    { label: '10k', hint: 'Single Debezium task', patch: { maxChangeRps: 10000 } },
    { label: '100k', hint: 'Kafka Connect cluster', patch: { maxChangeRps: 100000 } },
    { label: '1M', hint: 'Partitioned CDC at scale', patch: { maxChangeRps: 1000000 } },
  ],

  outflowFraction: (params) => num(params, 'captureRatio', 0.2),

  simSpec: (params) => ({
    servers: Infinity,
    serviceRate: Infinity,
    queueCap: Infinity,
    fixedLatencySec: num(params, 'lagMs', 500) / 1000,
    errorRate: 0,
    branchProb: num(params, 'captureRatio', 0.2),
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    if (inflow <= 0) return { metrics: idleMetrics(1), explain: [] };
    const capture = num(params, 'captureRatio', 0.2);
    const cap = num(params, 'maxChangeRps', 100000);
    const changes = inflow * capture;
    const lag = num(params, 'lagMs', 500) / 1000;
    const rho = changes / cap;
    const overloaded = rho >= 1;
    return {
      metrics: {
        arrivalRate: inflow,
        throughput: changes * (1 - downstreamErrorRate),
        rho,
        servers: 1,
        inSystem: changes * lag,
        inQueue: 0,
        latency: { mean: lag, p50: lag, p95: lag, p99: lag * 1.5 },
        dropRate: 0,
        errorRate: downstreamErrorRate,
        stable: !overloaded,
        overloaded,
        backlogGrowth: overloaded ? changes - cap : 0,
      },
      explain: [
        {
          metric: 'arrivalRate',
          text: `Capturing ${(capture * 100).toFixed(0)}% of ${inflow.toFixed(0)} req/s ⇒ ${changes.toFixed(0)} changes/s to the topic, ~${num(params, 'lagMs', 500)} ms behind the commit.`,
          formula: 'changes/s = λ · captureRatio',
        },
        overloaded
          ? {
              metric: 'backlogGrowth',
              text: `Change rate ${changes.toFixed(0)}/s exceeds the connector's ${cap.toFixed(0)}/s — CDC lag will grow without bound. Partition the connector.`,
              dominantTerm: 'connector throughput',
            }
          : {
              metric: 'rho',
              text: `Connector at ${(rho * 100).toFixed(0)}% of its ${cap.toFixed(0)} changes/s ceiling.`,
            },
      ],
    };
  },
};
