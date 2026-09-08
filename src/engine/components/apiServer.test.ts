import { describe, expect, it } from 'vitest';
import { deriveConcurrency, effectiveServiceMs } from './apiServer';

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

describe('co-located database on the app server', () => {
  it('adds local query time to the per-request service time', () => {
    const off = { serviceTimeMs: 40, colocatedDb: false };
    const on = { serviceTimeMs: 40, colocatedDb: true, queriesPerRequest: 3, dbQueryMs: 6 };
    expect(effectiveServiceMs(off)).toBe(40);
    expect(effectiveServiceMs(on)).toBe(40 + 3 * 6); // 58 ms
  });

  it('carves the DB buffer pool out of RAM, which can flip the box RAM-bound', () => {
    const shape = { vcpus: 4, parallelPerVcpu: 8, ramGB: 4, memPerReqMB: 40 };
    const standalone = deriveConcurrency(shape); // 4096/40 = 102 mem vs 32 cpu -> cpu-bound
    expect(standalone.bound).toBe('cpu');
    const withDb = deriveConcurrency({ ...shape, colocatedDb: true, dbBufferGB: 3 });
    // only 1 GB left for requests -> 1024/40 = 25 slots -> RAM-bound
    expect(withDb.bound).toBe('ram');
    expect(withDb.concurrency).toBeLessThan(standalone.concurrency);
  });
});
