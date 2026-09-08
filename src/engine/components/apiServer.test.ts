import { describe, expect, it } from 'vitest';
import { deriveConcurrency } from './apiServer';

describe('deriveConcurrency — provider-style server sizing', () => {
  it('is CPU-bound when RAM is plentiful', () => {
    const s = deriveConcurrency({ vcpus: 4, parallelPerVcpu: 8, ramGB: 32, memPerReqMB: 40 });
    expect(s.cpuSlots).toBe(32); // 4 · 8
    expect(s.memSlots).toBeGreaterThan(32);
    expect(s.concurrency).toBe(32);
    expect(s.bound).toBe('cpu');
  });

  it('is RAM-bound when memory per request is heavy', () => {
    const s = deriveConcurrency({ vcpus: 8, parallelPerVcpu: 8, ramGB: 2, memPerReqMB: 128 });
    expect(s.cpuSlots).toBe(64); // 8 · 8
    expect(s.memSlots).toBe(16); // 2048 / 128
    expect(s.concurrency).toBe(16);
    expect(s.bound).toBe('ram');
  });

  it('adding RAM lifts a RAM-bound box until the CPU becomes the limit', () => {
    const base = { vcpus: 4, parallelPerVcpu: 8, memPerReqMB: 100 };
    expect(deriveConcurrency({ ...base, ramGB: 1 }).concurrency).toBe(10); // ram-bound
    expect(deriveConcurrency({ ...base, ramGB: 8 }).concurrency).toBe(32); // cpu-bound (4·8)
  });

  it('honours an explicit concurrency override', () => {
    const s = deriveConcurrency({ concurrency: 7, vcpus: 99, ramGB: 99 });
    expect(s.concurrency).toBe(7);
  });

  it('never drops below one slot', () => {
    expect(deriveConcurrency({ vcpus: 0.25, parallelPerVcpu: 1, ramGB: 0.1, memPerReqMB: 512 }).concurrency).toBe(1);
  });
});
