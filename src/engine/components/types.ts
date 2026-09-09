import type { ZodType } from 'zod';
import type {
  BreakerState,
  ComponentType,
  EdgeSpec,
  ExplainNote,
  NodeMetrics,
  NodeSpec,
} from '../types';

export type { BreakerState };

/** How a component distributes its inflow across outgoing edges. */
export type RoutingMode =
  | 'passthrough' // 100% continues, split across outgoing edges by weight (LB)
  | 'replicate' // full inflow sent to every downstream dependency (app server fan-out)
  | 'branch' // a fraction continues downstream, the rest short-circuits (cache, CDN)
  | 'sink'; // nothing continues (database, dead-end)

export interface SolveNodeCtx {
  node: NodeSpec;
  params: Record<string, unknown>;
  /** Total offered arrival rate into this node (req/s), post-routing + retries. */
  inflow: number;
  /** Failure probability observed on the downstream dependencies (0..1). */
  downstreamErrorRate: number;
}

/**
 * Everything the discrete-event simulator needs to model a node as a single
 * queueing station. Deriving this from the same params as `solve()` keeps the
 * analytical and simulated layers structurally identical (see convergence.test).
 */
export interface SimSpec {
  /** Parallel service slots (c). `Infinity` for pass-through / infinite-server. */
  servers: number;
  /** Exponential service rate per slot, req/s. `Infinity` for instantaneous. */
  serviceRate: number;
  /** Waiting slots beyond `servers`. `Infinity` = unbounded queue (no shedding). */
  queueCap: number;
  /** Deterministic latency added to every request through the node (seconds). */
  fixedLatencySec: number;
  /** Per-request intrinsic error probability. */
  errorRate: number;
  /** Probability a served request continues downstream (vs. short-circuits). */
  branchProb: number;
  /** Present only on a circuit-breaker node — makes the DES run the state machine. */
  breaker?: BreakerSpec;
  /** Per-invocation cold-start penalty (serverless): with probability `rate`,
   *  add `extraSec` to the service time. */
  coldStart?: { rate: number; extraSec: number };
}

/** Circuit-breaker configuration the DES needs to run its state machine. */
export interface BreakerSpec {
  /** Downstream error fraction (over the window) that trips the breaker open. */
  thresholdFrac: number;
  /** Rolling observation window, seconds. */
  windowSec: number;
  /** Time spent OPEN (fast-failing everything) before a half-open probe. */
  cooldownSec: number;
  /** Consecutive successful probes needed to re-close from half-open. */
  halfOpenProbes: number;
  /** Error probability of a fast-fail response while OPEN (1 = always errors). */
  fallbackErrorRate: number;
  /** Latency of a fast-fail response, seconds. */
  fastFailSec: number;
}

export type ComponentCategory =
  | 'source'
  | 'compute'
  | 'data'
  | 'network'
  | 'messaging'
  | 'resilience'
  | 'external';

/** Visual tier — drives how the node card is drawn. */
export type ComponentTier = 'primary' | 'infra' | 'external';

export function tierOf(category: ComponentCategory): ComponentTier {
  if (category === 'external') return 'external';
  if (category === 'source' || category === 'compute') return 'primary';
  return 'infra';
}

export interface ScaleParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
}

/** A named bundle of param values — e.g. a standard cloud instance shape.
 *  Rendered as a quick-pick chip row above the fields in the Inspector. */
export interface ParamPreset {
  /** Short chip label, e.g. "2·8". */
  label: string;
  /** Longer hint for the tooltip, e.g. "m5.large — 2 vCPU / 8 GB". */
  hint?: string;
  /** Params merged onto the node when picked. */
  patch: Record<string, unknown>;
}

/** Resolve the effective scale knob for a node given its current params. */
export function resolveScaleParam(
  model: ComponentModel,
  params: Record<string, unknown>,
): ScaleParam | undefined {
  return typeof model.scaleParam === 'function' ? model.scaleParam(params) : model.scaleParam;
}

export interface ComponentModel {
  type: ComponentType;
  label: string;
  category: ComponentCategory;
  routing: RoutingMode;
  /** Ports the node exposes on the canvas. */
  handles: { in: boolean; out: boolean };
  defaultParams: Record<string, unknown>;
  paramSchema: ZodType;
  /** Human-readable one-liner per param, for the Inspector + docs. */
  paramDocs: Record<string, string>;
  /** Primary "scale out / in" knob, exposed as a ± stepper on the node itself.
   *  A function form lets it depend on other params (e.g. DB architecture). */
  scaleParam?: ScaleParam | ((params: Record<string, unknown>) => ScaleParam | undefined);
  /** Optionally hide a param in the Inspector based on the current params
   *  (e.g. architecture-specific knobs on the database). */
  fieldVisible?: (key: string, params: Record<string, unknown>) => boolean;
  /** Standard param bundles (e.g. cloud instance shapes) shown as quick-pick
   *  chips above the sliders, alongside the fine-tuning ranges. */
  presets?: ParamPreset[];
  /** One-line caption under the presets explaining what the chip labels mean
   *  (e.g. "vCPU · RAM (GB)"). */
  presetLegend?: string;

  /**
   * Fraction of inflow (0..1) that continues to downstream edges. 1 for
   * passthrough/replicate, `1 − hitRatio` for a cache, `1 − offload` for a CDN,
   * 0 for a sink. Called by the flow solver.
   *  - `ctx.downstreamFailure` — the current end-to-end failure estimate for
   *    everything past this node (a circuit breaker uses it to compute how often
   *    it is OPEN and shielding).
   *  - `ctx.inflow` — the node's current offered rate (req/s), for models whose
   *    forwarded fraction is load-dependent (an API gateway sheds the load above
   *    its rate limit as 429s, so the backend sees less).
   */
  outflowFraction(
    params: Record<string, unknown>,
    ctx?: { downstreamFailure?: number; inflow?: number },
  ): number;

  /** Steady-state analytical solve for one node. */
  solve(ctx: SolveNodeCtx): { metrics: NodeMetrics; explain: ExplainNote[] };

  /** Single-station spec for the discrete-event simulator. */
  simSpec(params: Record<string, unknown>): SimSpec;

  /** Baseline load this node originates on its own — a scheduled batch job's
   *  average record rate (req/s). Analytical only; omitted by every other type. */
  selfLoad?(params: Record<string, unknown>): number;
}

/** Narrowing helper for reading numeric params with a fallback. */
export function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function bool(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = params[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function str(params: Record<string, unknown>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}

/** Build the zero/idle metrics object (used when inflow ≈ 0). */
export function idleMetrics(servers: number): NodeMetrics {
  return {
    arrivalRate: 0,
    throughput: 0,
    rho: 0,
    servers,
    inSystem: 0,
    inQueue: 0,
    latency: { mean: 0, p50: 0, p95: 0, p99: 0 },
    dropRate: 0,
    errorRate: 0,
    stable: true,
    overloaded: false,
    backlogGrowth: 0,
  };
}

/** Shared edge helpers. */
export type OutEdge = EdgeSpec;
