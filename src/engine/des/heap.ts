/** Binary min-heap keyed by a numeric priority. Used as the DES event queue. */
export class MinHeap<T> {
  private items: { key: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  peekKey(): number | undefined {
    return this.items[0]?.key;
  }

  push(key: number, value: T): void {
    const a = this.items;
    a.push({ key, value });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].key <= a[i].key) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0].value;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < a.length && a[l].key < a[smallest].key) smallest = l;
        if (r < a.length && a[r].key < a[smallest].key) smallest = r;
        if (smallest === i) break;
        [a[i], a[smallest]] = [a[smallest], a[i]];
        i = smallest;
      }
    }
    return top;
  }

  clear(): void {
    this.items.length = 0;
  }
}
