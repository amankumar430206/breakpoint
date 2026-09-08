/**
 * Log-spaced latency histogram (seconds). Fixed buckets from 100 µs to 100 s,
 * ~16 buckets/decade, plus an overflow bucket. Good enough for p50/p95/p99 with
 * bounded memory and O(1) record.
 */
const MIN = 1e-4; // 0.1 ms
const MAX = 100; // 100 s
const PER_DECADE = 16;
const DECADES = Math.log10(MAX / MIN); // 6
const BUCKETS = Math.ceil(DECADES * PER_DECADE);

export class Histogram {
  private counts = new Float64Array(BUCKETS + 1);
  private total = 0;
  private sum = 0;

  static readonly size = BUCKETS + 1;

  record(value: number): void {
    this.total += 1;
    this.sum += value;
    if (value <= MIN) {
      this.counts[0] += 1;
      return;
    }
    const idx = Math.floor(Math.log10(value / MIN) * PER_DECADE);
    this.counts[idx >= BUCKETS ? BUCKETS : idx] += 1;
  }

  get count(): number {
    return this.total;
  }

  get mean(): number {
    return this.total > 0 ? this.sum / this.total : 0;
  }

  /** Lower edge (seconds) of bucket i. */
  private static edge(i: number): number {
    return MIN * Math.pow(10, i / PER_DECADE);
  }

  quantile(q: number): number {
    if (this.total === 0) return 0;
    const target = q * this.total;
    let acc = 0;
    for (let i = 0; i <= BUCKETS; i++) {
      acc += this.counts[i];
      if (acc >= target) {
        const lo = Histogram.edge(i);
        const hi = i >= BUCKETS ? MAX : Histogram.edge(i + 1);
        const inBucket = this.counts[i] || 1;
        const frac = (acc - target) / inBucket;
        return hi - (hi - lo) * frac;
      }
    }
    return MAX;
  }

  reset(): void {
    this.counts.fill(0);
    this.total = 0;
    this.sum = 0;
  }

  merge(other: Histogram): void {
    for (let i = 0; i < this.counts.length; i++) this.counts[i] += other.counts[i];
    this.total += other.total;
    this.sum += other.sum;
  }
}
