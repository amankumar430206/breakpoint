import { z } from 'zod';
import { mmc } from '../queueing';
import { metricsFromQueue } from './util';
import type { ExplainNote } from '../types';
import { idleMetrics, num, str, type ComponentModel } from './types';

/**
 * Vector database — Pinecone / pgvector / Milvus / Qdrant. Approximate
 * nearest-neighbour search over embeddings (RAG, semantic search,
 * recommendations). Two things drive it:
 *
 *  - the **index type**: `flat` is exact but scans every vector (cost grows with
 *    `vectorCount`); `hnsw` is a graph walk (near-constant, ~log); `ivf` is in
 *    between. Bigger `topK` and `dimensions` cost proportionally more.
 *  - **memory**: the index has to fit in `ramGB` (float32 vectors + graph
 *    overhead). When it doesn't it spills to disk and queries slow 10×+ — the
 *    node becomes memory-bound.
 */
const INDEX = {
  flat: { queryPerM: 60, writeFactor: 0.05, ramOverhead: 1.0 },
  ivf: { queryPerM: 3, writeFactor: 0.3, ramOverhead: 1.15 },
  hnsw: { queryPerM: 1, writeFactor: 1.0, ramOverhead: 1.9 },
} as const;
type IndexType = keyof typeof INDEX;

export const vectorDbModel: ComponentModel = {
  type: 'vectorDb',
  label: 'Vector DB',
  category: 'data',
  routing: 'sink',
  handles: { in: true, out: false },
  defaultParams: {
    indexType: 'hnsw',
    dimensions: 768,
    topK: 10,
    queryTimeMs: 4,
    vectorCount: 2_000_000,
    writeRatio: 0.1,
    ramGB: 16,
    poolSize: 64,
    intrinsicErrorRate: 0.0005,
  },
  paramSchema: z.object({
    indexType: z.enum(['hnsw', 'ivf', 'flat']).default('hnsw'),
    dimensions: z.number().int().min(2).max(65536).default(768),
    topK: z.number().int().min(1).max(10000).default(10),
    queryTimeMs: z.number().positive().max(60000).default(4),
    vectorCount: z.number().int().positive().max(1e12).default(2_000_000),
    writeRatio: z.number().min(0).max(1).default(0.1),
    ramGB: z.number().positive().max(4096).default(16),
    poolSize: z.number().int().positive().max(10000).default(64),
    intrinsicErrorRate: z.number().min(0).max(1).default(0.0005),
  }),
  paramDocs: {
    indexType: 'flat = exact brute-force; hnsw = fast graph walk; ivf = clustered, in between.',
    dimensions: 'Embedding dimensionality — query cost scales with it.',
    topK: 'Neighbours returned per query.',
    queryTimeMs: 'Base HNSW query time at topK 10, 768 dims, 1 M vectors.',
    vectorCount: 'Vectors in the index — drives memory, and flat query time.',
    writeRatio: 'Fraction of operations that are upserts (index inserts).',
    ramGB: 'Memory for the index. If it does not fit, queries spill to disk.',
    poolSize: 'Concurrent query slots.',
    intrinsicErrorRate: 'Baseline error rate.',
  },
  scaleParam: { key: 'poolSize', label: 'query slots', min: 1, max: 2000 },

  presetLegend: 'concurrent query slots',
  presets: [
    { label: '16', hint: 'Single small node', patch: { poolSize: 16 } },
    { label: '64', hint: 'Standard node', patch: { poolSize: 64 } },
    { label: '256', hint: 'Large / replicated', patch: { poolSize: 256 } },
  ],

  outflowFraction: () => 0,

  simSpec: (params) => {
    const pool = Math.max(1, Math.round(num(params, 'poolSize', 64)));
    return {
      servers: pool,
      serviceRate: 1000 / blendedMs(params),
      queueCap: Infinity,
      fixedLatencySec: 0,
      errorRate: num(params, 'intrinsicErrorRate', 0.0005),
      branchProb: 0,
    };
  },

  solve: ({ params, inflow, downstreamErrorRate }) => {
    const pool = Math.max(1, Math.round(num(params, 'poolSize', 64)));
    if (inflow <= 0) return { metrics: idleMetrics(pool), explain: [] };

    const kind = (str(params, 'indexType', 'hnsw') as IndexType) in INDEX
      ? (str(params, 'indexType', 'hnsw') as IndexType)
      : 'hnsw';
    const spec = INDEX[kind];
    const svcMs = blendedMs(params);
    const mu = 1000 / svcMs;
    const qr = mmc(inflow, mu, pool);
    const metrics = metricsFromQueue(qr, {
      offered: inflow,
      capacity: pool * mu,
      servers: pool,
      intrinsicErrorRate: num(params, 'intrinsicErrorRate', 0.0005),
      downstreamErrorRate,
    });

    const { indexGB, ramGB, spill } = memory(params, spec);
    const explain: ExplainNote[] = [
      {
        metric: 'latency.mean',
        text: `${kind.toUpperCase()} index, topK ${num(params, 'topK', 10)}, ${num(params, 'dimensions', 768)} dims${kind === 'flat' ? `, ${(num(params, 'vectorCount', 2e6) / 1e6).toFixed(1)} M vectors` : ''} ⇒ ~${(svcMs).toFixed(1)} ms per op. Capacity ≈ ${(pool * mu).toFixed(0)} ops/s.`,
        formula: kind === 'flat' ? 'flat: cost ∝ vectorCount' : `${kind}: near-constant graph/cluster walk`,
        dominantTerm: spill ? 'disk spill (out of RAM)' : kind === 'flat' ? 'brute-force scan' : 'query slots',
      },
      {
        metric: 'rho',
        text: spill
          ? `Index needs ~${indexGB.toFixed(1)} GB but only ${ramGB} GB RAM — it spills to disk, so every query is ~${(spillFactor(indexGB, ramGB)).toFixed(0)}× slower. Add RAM, shard the index, or use a smaller embedding.`
          : `Index fits in RAM (~${indexGB.toFixed(1)} of ${ramGB} GB) — CPU / query-slot bound.`,
      },
    ];
    if (kind === 'flat' && num(params, 'vectorCount', 2e6) > 500_000) {
      explain.push({
        metric: 'latency.mean',
        text: `A flat index rescans all ${(num(params, 'vectorCount', 2e6) / 1e6).toFixed(1)} M vectors per query — switch to HNSW for near-constant latency (a small recall trade-off).`,
      });
    }
    return { metrics, explain };
  },
};

function effQueryMs(params: Record<string, unknown>, spec: (typeof INDEX)[IndexType]): number {
  const base = num(params, 'queryTimeMs', 4);
  const dimFactor = num(params, 'dimensions', 768) / 768;
  const topKFactor = 1 + Math.log2(Math.max(1, num(params, 'topK', 10)) / 10) * 0.3;
  const sizeFactor =
    spec === INDEX.flat ? Math.max(1, num(params, 'vectorCount', 2e6) / 1e6) : 1;
  let ms = base * spec.queryPerM * dimFactor * Math.max(0.5, topKFactor) * sizeFactor;
  const { indexGB, ramGB, spill } = memory(params, spec);
  if (spill) ms *= spillFactor(indexGB, ramGB);
  return ms;
}

function blendedMs(params: Record<string, unknown>): number {
  const kind = (str(params, 'indexType', 'hnsw') as IndexType) in INDEX
    ? (str(params, 'indexType', 'hnsw') as IndexType)
    : 'hnsw';
  const spec = INDEX[kind];
  const q = effQueryMs(params, spec);
  const w = q * spec.writeFactor;
  const wr = num(params, 'writeRatio', 0.1);
  return (1 - wr) * q + wr * w;
}

function memory(params: Record<string, unknown>, spec: (typeof INDEX)[IndexType]) {
  const bytes = num(params, 'vectorCount', 2e6) * num(params, 'dimensions', 768) * 4 * spec.ramOverhead;
  const indexGB = bytes / 1e9;
  const ramGB = num(params, 'ramGB', 16);
  return { indexGB, ramGB, spill: indexGB > ramGB };
}

function spillFactor(indexGB: number, ramGB: number): number {
  return 10 + Math.max(0, indexGB / ramGB - 1) * 20;
}
