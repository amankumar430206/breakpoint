import { z } from 'zod';
import { DESIGN_SCHEMA_VERSION, type SystemDesign } from '@/engine';

const vec2 = z.object({ x: z.number(), y: z.number() });

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: vec2,
  label: z.string().optional(),
  zone: z.string().optional(),
  params: z.record(z.unknown()).default({}),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
  params: z.record(z.unknown()).default({}),
});

const scenarioSchema = z.object({
  kind: z.enum(['constant', 'ramp', 'diurnal', 'spike', 'thunderingHerd']),
  mode: z.enum(['rps', 'users']).optional(),
  targetRps: z.number().nonnegative(),
  users: z.number().nonnegative().optional(),
  thinkTimeSec: z.number().positive().optional(),
  durationSec: z.number().positive(),
  peakFactor: z.number().positive().optional(),
});

const designSchema = z.object({
  version: z.number().int().positive().default(DESIGN_SCHEMA_VERSION),
  name: z.string().default('Imported design'),
  description: z.string().optional(),
  notes: z.string().optional(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  sim: z.object({
    scenario: scenarioSchema,
    seed: z.number().int().nonnegative().default(1),
    speed: z.number().positive().default(4),
  }),
});

export type ParseResult =
  | { ok: true; design: SystemDesign; warnings: string[] }
  | { ok: false; error: string };

/** Validate & normalise an arbitrary object into a SystemDesign. */
export function parseDesign(input: unknown): ParseResult {
  const parsed = designSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid design shape' };
  }
  const d = parsed.data;
  const warnings: string[] = [];

  const ids = new Set(d.nodes.map((n) => n.id));
  if (ids.size !== d.nodes.length) return { ok: false, error: 'Duplicate node ids' };

  const validEdges = d.edges.filter((e) => {
    const good = ids.has(e.source) && ids.has(e.target);
    if (!good) warnings.push(`Dropped edge ${e.id}: unknown endpoint`);
    return good;
  });

  if (d.version > DESIGN_SCHEMA_VERSION) {
    warnings.push(
      `Design was saved by a newer version (v${d.version}); loading on a best-effort basis.`,
    );
  }

  return {
    ok: true,
    design: { ...d, version: DESIGN_SCHEMA_VERSION, edges: validEdges } as SystemDesign,
    warnings,
  };
}

/** Pretty JSON for download / clipboard. */
export function serializeDesign(design: SystemDesign): string {
  return JSON.stringify(design, null, 2);
}

export function parseDesignJson(text: string): ParseResult {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON' };
  }
  return parseDesign(obj);
}
