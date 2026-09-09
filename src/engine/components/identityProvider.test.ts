import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';

const m = getModel('identityProvider');
const solve = (params: Record<string, unknown>, inflow: number) =>
  m.solve({
    node: { id: 'idp', type: 'identityProvider', position: { x: 0, y: 0 }, params },
    params: { ...m.defaultParams, ...params },
    inflow,
    downstreamErrorRate: 0,
  });

describe('identityProvider', () => {
  it('is a sink', () => {
    expect(m.routing).toBe('sink');
    expect(m.outflowFraction({})).toBe(0);
  });

  it('the session cache takes load off the introspection path', () => {
    const base = { introspectMs: 10, tokenIssueMs: 30, issueRatio: 0.05, poolSize: 64 } as const;
    const cold = solve({ ...base, sessionCacheHitRatio: 0.1 }, 3000);
    const warm = solve({ ...base, sessionCacheHitRatio: 0.9 }, 3000);
    expect(warm.metrics.rho).toBeLessThan(cold.metrics.rho * 0.5);
  });

  it('token issue is the expensive path', () => {
    const base = { introspectMs: 8, tokenIssueMs: 40, sessionCacheHitRatio: 0, poolSize: 64 } as const;
    const validateHeavy = solve({ ...base, issueRatio: 0.05 }, 3000);
    const issueHeavy = solve({ ...base, issueRatio: 0.6 }, 3000);
    expect(issueHeavy.metrics.rho).toBeGreaterThan(validateHeavy.metrics.rho * 2);
  });

  it('surfaces the provider error rate', () => {
    const r = solve({ providerErrorRate: 0.05, poolSize: 128 }, 500);
    expect(r.metrics.errorRate).toBeGreaterThan(0.04);
  });
});
