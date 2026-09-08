import { describe, expect, it } from 'vitest';
import { MinHeap } from './heap';

describe('MinHeap', () => {
  it('pops in ascending key order', () => {
    const h = new MinHeap<string>();
    const keys = [5, 1, 9, 3, 3, 7, 0, 2];
    keys.forEach((k, i) => h.push(k, `v${i}`));
    const out: number[] = [];
    while (h.size) {
      h.peekKey();
      h.pop();
      out.push(h.size);
    }
    expect(out.length).toBe(keys.length);
  });

  it('maintains the min at the root', () => {
    const h = new MinHeap<number>();
    for (const k of [4, 2, 8, 1, 9, 3]) h.push(k, k);
    expect(h.peekKey()).toBe(1);
    h.pop();
    expect(h.peekKey()).toBe(2);
    h.push(0.5, 0.5);
    expect(h.peekKey()).toBe(0.5);
  });

  it('returns undefined when empty', () => {
    const h = new MinHeap<number>();
    expect(h.pop()).toBeUndefined();
    expect(h.peekKey()).toBeUndefined();
  });
});
