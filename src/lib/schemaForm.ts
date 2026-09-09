import { z } from 'zod';

export interface FieldDesc {
  key: string;
  kind: 'number' | 'boolean' | 'enum' | 'string';
  options?: string[];
  min?: number;
  max?: number;
  int?: boolean;
  default?: unknown;
}

/** Peel ZodDefault / ZodOptional / ZodNullable wrappers to the core type. */
function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; def?: unknown } {
  let s = schema;
  let def: unknown;
  for (let i = 0; i < 8; i++) {
    const d = (s as unknown as { _def: { typeName: string; innerType?: z.ZodTypeAny; defaultValue?: () => unknown } })._def;
    if (d.typeName === 'ZodDefault' && d.innerType) {
      def = d.defaultValue?.();
      s = d.innerType;
    } else if ((d.typeName === 'ZodOptional' || d.typeName === 'ZodNullable') && d.innerType) {
      s = d.innerType;
    } else {
      break;
    }
  }
  return { inner: s, def };
}

/** Introspect a ZodObject param schema into a flat list of form fields. */
export function describeSchema(schema: z.ZodTypeAny): FieldDesc[] {
  const obj = schema as unknown as { _def: { typeName: string; shape?: () => Record<string, z.ZodTypeAny> } };
  if (obj._def.typeName !== 'ZodObject' || !obj._def.shape) return [];
  const shape = obj._def.shape();

  return Object.entries(shape).map(([key, raw]) => {
    const { inner, def } = unwrap(raw);
    const d = (inner as unknown as { _def: { typeName: string; checks?: Array<{ kind: string; value?: number }>; values?: string[] } })._def;

    if (d.typeName === 'ZodBoolean') return { key, kind: 'boolean' as const, default: def };
    if (d.typeName === 'ZodEnum') return { key, kind: 'enum' as const, options: d.values ?? [], default: def };
    if (d.typeName === 'ZodNumber') {
      let min: number | undefined;
      let max: number | undefined;
      let int = false;
      for (const c of d.checks ?? []) {
        if (c.kind === 'min') min = c.value;
        else if (c.kind === 'max') max = c.value;
        else if (c.kind === 'int') int = true;
      }
      return { key, kind: 'number' as const, min, max, int, default: def };
    }
    return { key, kind: 'string' as const, default: def };
  });
}

/**
 * Standard values per parameter, shown as quick-pick chips beside the slider
 * (the same "range + presets" pattern as the Users control). Keyed by param
 * key so it works for every component. Values outside a field's min/max are
 * filtered out at render time.
 */
export const FIELD_PRESETS: Record<string, number[]> = {
  // compute box shape
  vcpus: [1, 2, 4, 8, 16, 32, 64, 128],
  ramGB: [1, 2, 4, 8, 16, 32, 64, 128, 256],
  storageGB: [20, 40, 80, 160, 320, 640, 1280],
  parallelPerVcpu: [1, 2, 4, 8, 16, 32, 64, 128],
  memPerReqMB: [8, 20, 40, 100, 250, 512, 1024],
  serviceTimeMs: [5, 10, 25, 50, 100, 250, 500, 1000],
  jobTimeMs: [50, 100, 250, 500, 1000, 5000, 30000],
  execTimeMs: [10, 25, 50, 100, 250, 500, 1000, 5000],
  coldStartMs: [0, 100, 250, 400, 800, 2000, 5000],
  coldStartRate: [0, 0.01, 0.03, 0.05, 0.1, 0.25, 0.5],
  maxConcurrency: [100, 250, 500, 1000, 3000, 10000, 30000],
  replicas: [1, 2, 3, 5, 10, 20, 50, 100, 250],
  maxReplicas: [10, 20, 50, 100, 250, 500],
  queueLimit: [0, 50, 100, 500, 1000, 5000, 20000],
  // database
  poolSize: [10, 20, 40, 90, 180, 350, 700, 2000],
  queryTimeMs: [1, 2, 4, 8, 16, 32, 64, 128],
  readReplicas: [0, 1, 2, 3, 5, 10, 20],
  primaries: [2, 3, 4, 5, 8, 16],
  shards: [2, 4, 8, 16, 32, 64, 128, 256],
  replicationLagMs: [0, 10, 50, 100, 500, 2000],
  dbQueryMs: [1, 2, 4, 8, 16, 32],
  queriesPerRequest: [1, 2, 3, 5, 8, 15],
  dbBufferGB: [0.5, 1, 2, 4, 8, 16, 32],
  // capacity / throughput
  capacityRps: [20_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000],
  brokerThroughputRps: [10_000, 50_000, 200_000, 1_000_000, 10_000_000],
  opsRps: [50_000, 200_000, 1_000_000, 5_000_000, 20_000_000],
  edgeCapacityRps: [500_000, 2_000_000, 10_000_000, 50_000_000],
  rateLimitRps: [100, 500, 1000, 5000, 20_000, 100_000],
  partitions: [1, 3, 6, 12, 24, 48],
  // latencies
  latencyMs: [20, 50, 100, 250, 500, 1000],
  edgeLatencyMs: [2, 5, 10, 25, 50, 100],
  hitLatencyMs: [0.2, 0.5, 1, 2, 5],
  opLatencyMs: [1, 5, 10, 25, 50, 100],
  jitterMs: [10, 25, 50, 100, 250],
  // edges
  netLatencyMs: [0, 1, 2, 5, 10, 40, 80, 150],
  timeoutSec: [0.1, 0.5, 1, 2, 5, 10, 30],
  backoffSec: [0, 0.1, 0.5, 1, 2, 5],
  callsPerRequest: [1, 2, 3, 5, 10],
  retries: [0, 1, 2, 3, 5],
  weight: [0.5, 1, 2, 3, 5],
};

/** Preset values for a field, clamped to its bounds. */
export function fieldPresets(f: FieldDesc): number[] {
  const all = FIELD_PRESETS[f.key];
  if (!all) return [];
  return all.filter((v) => v >= (f.min ?? -Infinity) && v <= (f.max ?? Infinity));
}

/** Compact chip label: 4 · 16 · 500k · 2M. */
export function chipValue(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}k`;
  return String(n);
}

/** A sensible slider step for a numeric field given its bounds. */
export function stepFor(f: FieldDesc): number {
  const span = (f.max ?? 1) - (f.min ?? 0);
  if (f.int) {
    // keep integer sliders draggable across very wide capacity ranges
    if (span > 5_000_000) return 100_000;
    if (span > 200_000) return 1_000;
    if (span > 5_000) return 10;
    return 1;
  }
  if (span <= 2) return 0.01;
  if (span <= 100) return 0.1;
  if (span <= 5000) return 1;
  if (span <= 200_000) return 10;
  if (span <= 5_000_000) return 1_000;
  return 100_000;
}

const ACRONYMS: Record<string, string> = {
  gb: 'GB', mb: 'MB', kb: 'KB', ms: 'ms', rps: 'rps', pct: '%', sec: 's',
  ram: 'RAM', cpu: 'CPU', vcpu: 'vCPU', vcpus: 'vCPUs', db: 'DB', ttl: 'TTL', api: 'API',
};

/** Hand-written labels where the automatic humaniser reads badly. */
const OVERRIDES: Record<string, string> = {
  memPerReqMB: 'Memory / request (MB)',
  parallelPerVcpu: 'Parallel requests / vCPU',
  crossShardPct: 'Cross-shard queries (%)',
  writeCoordinationPct: 'Write coordination (%)',
  callsPerRequest: 'Calls per request',
  targetUtil: 'Target utilization',
  keyDistribution: 'Key distribution',
  brokerThroughputRps: 'Broker throughput (rps)',
  opsRps: 'Throughput (ops/s)',
  intrinsicErrorRate: 'Baseline error rate',
  replicationLagMs: 'Replication lag (ms)',
  edgeCapacityRps: 'Edge capacity (rps)',
  hitLatencyMs: 'Hit latency (ms)',
  opLatencyMs: 'Op latency (ms)',
};

/** Turn a param key (`serviceTimeMs`, `ramGB`) into a readable label. */
export function prettyLabel(key: string): string {
  if (OVERRIDES[key]) return OVERRIDES[key];
  let base = key;
  let unit = '';
  const m = key.match(/(Ms|GB|MB|KB|Rps|Pct|Sec)$/);
  if (m) {
    base = key.slice(0, -m[0].length);
    unit = ` (${ACRONYMS[m[0].toLowerCase()] ?? m[0]})`;
  }
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const pretty = words
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (ACRONYMS[lw]) return ACRONYMS[lw];
      return i === 0 ? w[0].toUpperCase() + w.slice(1) : lw;
    })
    .join(' ');
  return pretty + unit;
}
