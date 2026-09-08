import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';
import type { SolveNodeCtx } from './types';

const ctx = (over: Partial<SolveNodeCtx>): SolveNodeCtx => ({
  node: { id: 'n', type: 'client', position: { x: 0, y: 0 }, params: {} },
  params: {},
  inflow: 0,
  downstreamErrorRate: 0,
  ...over,
});

describe('cdn', () => {
  const m = getModel('cdn');
  it('offloadRatio governs origin load', () => {
    expect(m.outflowFraction({ offloadRatio: 0.9 })).toBeCloseTo(0.1, 9);
    const r = m.solve(ctx({ params: { offloadRatio: 0.9, edgeCapacityRps: 1e6 }, inflow: 10000 }));
    expect(r.metrics.rho).toBeLessThan(0.05);
    expect(r.explain[0].text).toMatch(/1000 of 10000/);
  });
});

describe('queue', () => {
  const m = getModel('queue');
  it('passes traffic through with a small enqueue latency', () => {
    expect(m.outflowFraction({})).toBe(1);
    const r = m.solve(ctx({ params: { brokerThroughputRps: 50000, enqueueLatencyMs: 2 }, inflow: 5000 }));
    expect(r.metrics.latency.mean).toBeGreaterThan(0.002 - 1e-9);
    expect(r.metrics.rho).toBeCloseTo(0.1, 6);
  });
  it('exposes an unbounded buffer to the simulator', () => {
    expect(m.simSpec({}).queueCap).toBe(Infinity);
  });
});

describe('worker', () => {
  const m = getModel('worker');
  it('derives capacity from vCPU/RAM and does not shed by default', () => {
    expect(m.simSpec({}).queueCap).toBe(Infinity);
    // 2 vCPU · 3 = 6 CPU slots, RAM 4096/96 = 42 → 6 slots/worker, ×1 = 6, μ = 1000/150
    const params = { jobTimeMs: 150, vcpus: 2, parallelPerVcpu: 3, ramGB: 4, memPerReqMB: 96, replicas: 1 };
    const r = m.solve(ctx({ params, inflow: 30 }));
    expect(r.metrics.rho).toBeCloseTo(30 / (6 * (1000 / 150)), 3);
  });
  it('reports the queue backing up when consumers are overloaded', () => {
    const r = m.solve(ctx({ params: { jobTimeMs: 200, vcpus: 1, parallelPerVcpu: 2 }, inflow: 100 }));
    expect(r.metrics.overloaded).toBe(true);
    expect(r.metrics.backlogGrowth).toBeGreaterThan(0);
  });
});

describe('loadBalancer — multiple instances', () => {
  const m = getModel('loadBalancer');
  it('utilization falls ~1/n as active-active instances are added', () => {
    const one = m.solve(ctx({ params: { capacityRps: 10000, instances: 1 }, inflow: 8000 }));
    const four = m.solve(ctx({ params: { capacityRps: 10000, instances: 4 }, inflow: 8000 }));
    expect(one.metrics.rho).toBeCloseTo(0.8, 3);
    expect(four.metrics.rho).toBeCloseTo(0.2, 3);
  });
  it('one instance saturates where a pair has headroom', () => {
    const solo = m.solve(ctx({ params: { capacityRps: 10000, instances: 1 }, inflow: 12000 }));
    const pair = m.solve(ctx({ params: { capacityRps: 10000, instances: 2 }, inflow: 12000 }));
    expect(solo.metrics.overloaded).toBe(true);
    expect(pair.metrics.overloaded).toBe(false);
    expect(pair.metrics.rho).toBeCloseTo(0.6, 3);
  });
  it('scales on `instances`', () => {
    expect(m.scaleParam).toMatchObject({ key: 'instances' });
    expect(m.simSpec({ instances: 3 }).servers).toBe(3);
  });
});

describe('objectStore', () => {
  const m = getModel('objectStore');
  it('is a sink with a latency floor and huge capacity', () => {
    expect(m.outflowFraction({})).toBe(0);
    const r = m.solve(ctx({ params: { opLatencyMs: 25, opsRps: 200000 }, inflow: 8000 }));
    expect(r.metrics.latency.mean).toBeGreaterThan(0.025 - 1e-9);
    expect(r.metrics.overloaded).toBe(false);
  });
});

describe('externalService', () => {
  const m = getModel('externalService');
  it('rejects traffic above the rate limit as 429s', () => {
    const under = m.solve(ctx({ params: { rateLimitRps: 500 }, inflow: 300 }));
    expect(under.metrics.dropRate).toBe(0);
    expect(under.metrics.overloaded).toBe(false);

    const over = m.solve(ctx({ params: { rateLimitRps: 500 }, inflow: 2000 }));
    expect(over.metrics.dropRate).toBeCloseTo(1 - 500 / 2000, 6);
    expect(over.metrics.overloaded).toBe(true);
    expect(over.metrics.throughput).toBeLessThanOrEqual(500);
  });
  it('tail latency is latency + 3·jitter and it has no scale knob', () => {
    const r = m.solve(ctx({ params: { latencyMs: 100, jitterMs: 50 }, inflow: 10 }));
    expect(r.metrics.latency.p99).toBeCloseTo(0.25, 6);
    expect(m.scaleParam).toBeUndefined();
  });
});
