import { z } from 'zod';
import { mm1 } from '../queueing';
import { addLatency, metricsFromQueue } from './util';
import { bool, idleMetrics, num, str, type ComponentModel } from './types';

/**
 * Notification service — email / SMS / push via a provider (SES, Twilio, FCM,
 * APNs). Like `externalService` it has a hard provider **send-rate limit**, but
 * unlike a synchronous API it is **asynchronous**: over the limit, messages
 * queue and the backlog grows — they aren't rejected. Turn `asyncBuffer` off to
 * model a provider that hard-rejects instead.
 */
export const notificationServiceModel: ComponentModel = {
  type: 'notificationService',
  label: 'Notification Service',
  category: 'external',
  routing: 'sink',
  handles: { in: true, out: false },
  defaultParams: {
    channel: 'email',
    providerRateLimitRps: 200,
    sendLatencyMs: 300,
    jitterMs: 200,
    providerErrorRate: 0.02,
    asyncBuffer: true,
  },
  paramSchema: z.object({
    channel: z.enum(['email', 'sms', 'push', 'multi']).default('email'),
    providerRateLimitRps: z.number().positive().max(1000000).default(200),
    sendLatencyMs: z.number().nonnegative().max(60000).default(300),
    jitterMs: z.number().nonnegative().max(60000).default(200),
    providerErrorRate: z.number().min(0).max(1).default(0.02),
    asyncBuffer: z.boolean().default(true),
  }),
  paramDocs: {
    channel: 'Delivery channel — informational; set the rate limit to match your provider.',
    providerRateLimitRps: 'Messages/sec the provider accepts (SES quota, Twilio per-number, …).',
    sendLatencyMs: 'Provider send round-trip.',
    jitterMs: 'Send-time spread (drives the tail).',
    providerErrorRate: 'Provider bounce / failure rate.',
    asyncBuffer: 'On: over the limit, messages queue (backlog grows). Off: they are rejected.',
  },

  presetLegend: 'provider send rate (msg/s)',
  presets: [
    { label: '14', hint: 'SES sandbox', patch: { providerRateLimitRps: 14 } },
    { label: '200', hint: 'SES production quota', patch: { providerRateLimitRps: 200 } },
    { label: '1k', hint: 'Bulk email / SMS short code', patch: { providerRateLimitRps: 1000 } },
    { label: '50k', hint: 'FCM / APNs push', patch: { providerRateLimitRps: 50000 } },
  ],

  outflowFraction: () => 0,

  simSpec: (params) => {
    const limit = Math.max(1, num(params, 'providerRateLimitRps', 200));
    if (bool(params, 'asyncBuffer', true)) {
      return {
        servers: 1,
        serviceRate: limit,
        queueCap: Infinity, // the send buffer
        fixedLatencySec: num(params, 'sendLatencyMs', 300) / 1000,
        errorRate: num(params, 'providerErrorRate', 0.02),
        branchProb: 0,
      };
    }
    return {
      servers: Math.max(1, Math.round(limit)),
      serviceRate: 1,
      queueCap: 0, // hard reject over the limit
      fixedLatencySec: num(params, 'sendLatencyMs', 300) / 1000,
      errorRate: num(params, 'providerErrorRate', 0.02),
      branchProb: 0,
    };
  },

  solve: ({ params, inflow, downstreamErrorRate }) => {
    if (inflow <= 0) return { metrics: idleMetrics(1), explain: [] };
    const limit = Math.max(1, num(params, 'providerRateLimitRps', 200));
    const sendSec = num(params, 'sendLatencyMs', 300) / 1000;
    const jitterSec = num(params, 'jitterMs', 200) / 1000;
    const intrinsic = num(params, 'providerErrorRate', 0.02);
    const async = bool(params, 'asyncBuffer', true);
    const over = inflow > limit;

    let metrics;
    if (async) {
      const qr = mm1(inflow, limit);
      const base = metricsFromQueue(qr, {
        offered: inflow,
        capacity: limit,
        servers: 1,
        intrinsicErrorRate: intrinsic,
        downstreamErrorRate,
      });
      metrics = addLatency(base, sendSec);
      // async: over the limit is backlog, not error
      metrics = { ...metrics, dropRate: 0, backlogGrowth: over ? inflow - limit : 0 };
    } else {
      const served = Math.min(inflow, limit);
      metrics = {
        arrivalRate: inflow,
        throughput: served * (1 - intrinsic),
        rho: inflow / limit,
        servers: Math.round(limit),
        inSystem: served * sendSec,
        inQueue: 0,
        latency: {
          mean: sendSec,
          p50: sendSec,
          p95: sendSec + 2 * jitterSec,
          p99: sendSec + 3 * jitterSec,
        },
        dropRate: over ? 1 - served / inflow : 0,
        errorRate: intrinsic,
        stable: !over,
        overloaded: over,
        backlogGrowth: 0,
      };
    }
    if (async && Number.isFinite(metrics.latency.p99)) {
      metrics = {
        ...metrics,
        latency: {
          ...metrics.latency,
          p95: metrics.latency.p95 + 2 * jitterSec,
          p99: metrics.latency.p99 + 3 * jitterSec,
        },
      };
    }

    return {
      metrics,
      explain: [
        {
          metric: over ? 'backlogGrowth' : 'rho',
          text: over
            ? async
              ? `Sending ${inflow.toFixed(0)} ${str(params, 'channel', 'email')}/s at a ${limit.toFixed(0)}/s provider limit — the backlog grows ~${(inflow - limit).toFixed(0)}/s. Messages are late, not lost. Raise the quota, throttle producers, or spread across senders.`
              : `${inflow.toFixed(0)}/s over a ${limit.toFixed(0)}/s limit with no buffer — ${(((inflow - limit) / inflow) * 100).toFixed(0)}% rejected.`
            : `Under the ${limit.toFixed(0)} ${str(params, 'channel', 'email')}/s provider limit (${((inflow / limit) * 100).toFixed(0)}%).`,
          dominantTerm: 'provider rate limit',
        },
        {
          metric: 'latency.p99',
          text: `Provider send is ~${num(params, 'sendLatencyMs', 300)} ms ± ${num(params, 'jitterMs', 200)} ms; ${async ? 'plus any time queued behind the rate limit.' : 'rejections are immediate.'}`,
        },
      ],
    };
  },
};
