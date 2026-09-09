import { z } from 'zod';
import { mmc } from '../queueing';
import { metricsFromQueue } from './util';
import { idleMetrics, num, type ComponentModel } from './types';

/**
 * Identity provider / auth service — OAuth 2.0 / OIDC (Auth0, Okta, Cognito, or
 * self-hosted Keycloak). Two op types:
 *
 *  - **introspection / validation** — the common path; a `sessionCacheHitRatio`
 *    fraction come straight back from a session cache, the rest do the real
 *    check (`introspectMs`);
 *  - **token issue / refresh** — sign a JWT + a store write (`tokenIssueMs`),
 *    never cached.
 *
 * Usually called by the API gateway on every request.
 */
const HIT_SEC = 0.002;

export const identityProviderModel: ComponentModel = {
  type: 'identityProvider',
  label: 'Identity Provider',
  category: 'external',
  routing: 'sink',
  handles: { in: true, out: false },
  defaultParams: {
    introspectMs: 8,
    tokenIssueMs: 25,
    issueRatio: 0.15,
    sessionCacheHitRatio: 0.7,
    poolSize: 128,
    providerErrorRate: 0.002,
  },
  paramSchema: z.object({
    introspectMs: z.number().positive().max(60000).default(8),
    tokenIssueMs: z.number().positive().max(60000).default(25),
    issueRatio: z.number().min(0).max(1).default(0.15),
    sessionCacheHitRatio: z.number().min(0).max(1).default(0.7),
    poolSize: z.number().int().positive().max(10000).default(128),
    providerErrorRate: z.number().min(0).max(1).default(0.002),
  }),
  paramDocs: {
    introspectMs: 'Time to validate / introspect a token on the real path.',
    tokenIssueMs: 'Time to issue or refresh a token (sign + store write).',
    issueRatio: 'Fraction of calls that issue / refresh (vs validate).',
    sessionCacheHitRatio: 'Validations served instantly from the session cache.',
    poolSize: 'Concurrent request slots.',
    providerErrorRate: 'Baseline auth error / unavailability rate.',
  },
  scaleParam: { key: 'poolSize', label: 'slots', min: 1, max: 4000 },

  presetLegend: 'concurrent slots',
  presets: [
    { label: '64', hint: 'Small self-hosted', patch: { poolSize: 64 } },
    { label: '128', hint: 'Standard', patch: { poolSize: 128 } },
    { label: '512', hint: 'Large / managed', patch: { poolSize: 512 } },
  ],

  outflowFraction: () => 0,

  simSpec: (params) => ({
    servers: Math.max(1, Math.round(num(params, 'poolSize', 128))),
    serviceRate: 1000 / blendedMs(params),
    queueCap: Infinity,
    fixedLatencySec: 0,
    errorRate: num(params, 'providerErrorRate', 0.002),
    branchProb: 0,
  }),

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const pool = Math.max(1, Math.round(num(params, 'poolSize', 128)));
    if (inflow <= 0) return { metrics: idleMetrics(pool), explain: [] };

    const svc = blendedMs(params);
    const mu = 1000 / svc;
    const qr = mmc(inflow, mu, pool);
    const metrics = metricsFromQueue(qr, {
      offered: inflow,
      capacity: pool * mu,
      servers: pool,
      intrinsicErrorRate: num(params, 'providerErrorRate', 0.002),
      downstreamErrorRate,
    });

    const hit = num(params, 'sessionCacheHitRatio', 0.7);
    const ir = num(params, 'issueRatio', 0.15);
    return {
      metrics,
      explain: [
        {
          metric: 'rho',
          text: `${(ir * 100).toFixed(0)}% token issue (${num(params, 'tokenIssueMs', 25)} ms), ${((1 - ir) * (1 - hit) * 100).toFixed(0)}% real introspection (${num(params, 'introspectMs', 8)} ms), the rest from the session cache ⇒ ~${svc.toFixed(1)} ms blended, capacity ≈ ${(pool * mu).toFixed(0)}/s. ρ = ${qr.rho.toFixed(3)}.`,
          formula: 'svc = issueRatio·tokenIssueMs + (1−issueRatio)·((1−cacheHit)·introspectMs + cacheHit·2ms)',
          dominantTerm: ir > 0.4 ? 'token issue' : 'introspection',
        },
        {
          metric: 'latency.mean',
          text:
            hit < 0.5
              ? `Only ${(hit * 100).toFixed(0)}% of validations hit the session cache — every request to the gateway pays a real introspection. Raise the cache hit ratio (longer sessions / local JWT verification).`
              : `${(hit * 100).toFixed(0)}% of validations short-circuit at the session cache.`,
        },
      ],
    };
  },
};

function blendedMs(params: Record<string, unknown>): number {
  const ir = num(params, 'issueRatio', 0.15);
  const hit = num(params, 'sessionCacheHitRatio', 0.7);
  const introspect = (1 - hit) * num(params, 'introspectMs', 8) + hit * (HIT_SEC * 1000);
  return ir * num(params, 'tokenIssueMs', 25) + (1 - ir) * introspect;
}
