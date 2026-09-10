import { describe, expect, it } from 'vitest';
import { classifyStatus, ProbeAggregator, quantileSorted } from './aggregate';

describe('quantileSorted', () => {
  it('handles empty and singleton', () => {
    expect(quantileSorted([], 0.5)).toBe(0);
    expect(quantileSorted([42], 0.99)).toBe(42);
  });

  it('interpolates', () => {
    const xs = [0, 10, 20, 30, 40];
    expect(quantileSorted(xs, 0)).toBe(0);
    expect(quantileSorted(xs, 0.5)).toBe(20);
    expect(quantileSorted(xs, 1)).toBe(40);
    expect(quantileSorted(xs, 0.25)).toBe(10);
  });
});

describe('classifyStatus', () => {
  it('buckets by class, 429 = throttled', () => {
    expect(classifyStatus(200)).toBe('ok');
    expect(classifyStatus(302)).toBe('ok');
    expect(classifyStatus(404)).toBe('http-4xx');
    expect(classifyStatus(429)).toBe('throttled');
    expect(classifyStatus(503)).toBe('http-5xx');
  });
});

describe('ProbeAggregator', () => {
  it('windows drain and reset; totals accumulate', () => {
    const a = new ProbeAggregator();
    for (let i = 0; i < 10; i++) {
      a.markStart();
      a.push(i * 10, i < 8 ? 'ok' : 'http-5xx');
    }
    const w1 = a.drainWindow(1);
    expect(w1.count).toBe(10);
    expect(w1.achievedRps).toBe(10);
    expect(w1.errorRate).toBeCloseTo(0.2, 5);
    expect(w1.byClass['http-5xx']).toBe(2);
    expect(w1.p50).toBeCloseTo(45, 5);

    // second window is independent
    const w2 = a.drainWindow(1);
    expect(w2.count).toBe(0);

    a.markStart();
    a.push(5, 'ok');
    const s = a.summary(3);
    expect(s.totalRequests).toBe(11);
    expect(s.ok).toBe(9);
    expect(s.errors).toBe(2);
    expect(s.achievedRps).toBeCloseTo(11 / 3, 5);
  });

  it('tracks in-flight as started minus completed, carried across windows', () => {
    const a = new ProbeAggregator();
    a.markStart();
    a.markStart();
    a.markStart();
    a.push(1, 'ok'); // 1 of 3 done
    expect(a.inFlight).toBe(2);
    const w = a.drainWindow(1);
    expect(w.inFlight).toBe(2);
    a.push(2, 'ok');
    expect(a.inFlight).toBe(1);
  });
});
