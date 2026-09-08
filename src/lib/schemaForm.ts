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

/** A sensible slider step for a numeric field given its bounds. */
export function stepFor(f: FieldDesc): number {
  if (f.int) return 1;
  const span = (f.max ?? 1) - (f.min ?? 0);
  if (span <= 2) return 0.01;
  if (span <= 100) return 0.1;
  if (span <= 5000) return 1;
  return 10;
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
