/**
 * Core data model. A `SystemDesign` is the serializable document the whole app
 * revolves around: a graph of components plus a traffic scenario. The engine
 * turns it into a `SolveResult`; the UI renders both.
 *
 * All rates are per second, all times are in seconds. The formatting layer
 * converts to ms / RPS / % for display.
 */

export type ComponentType =
  | 'client'
  | 'loadBalancer'
  | 'apiServer'
  | 'cache'
  | 'sqlDatabase'
  | 'queue'
  | 'worker'
  | 'cdn'
  | 'objectStore'
  | 'externalService'
  | 'circuitBreaker'
  | 'apiGateway'
  | 'pubsubTopic'
  | 'dbProxy'
  | 'cdcConnector'
  | 'serverlessFn'
  | 'searchIndex'
  | 'analyticsDb'
  | 'vectorDb'
  | 'streamProcessor';

export interface Vec2 {
  x: number;
  y: number;
}

export interface NodeSpec {
  id: string;
  type: ComponentType;
  position: Vec2;
  label?: string;
  /** Region/AZ tag; drives inter-zone network latency once zones land. */
  zone?: string;
  /** Component-specific parameters, validated by the type's Zod schema. */
  params: Record<string, unknown>;
}

export interface EdgeParams {
  /** Relative weight for weighted routing at load balancers / shard routers. */
  weight?: number;
  /** Max retry attempts on failure (0 = no retry). */
  retries?: number;
  /** Per-attempt timeout, seconds (undefined = no timeout). */
  timeoutSec?: number;
  /** Base backoff between retries, seconds. */
  backoffSec?: number;
  /** Fixed one-way network latency for this hop, milliseconds (0 = same box). */
  netLatencyMs?: number;
  /** Calls to the downstream per upstream request (fan-out). */
  callsPerRequest?: number;
}

export interface EdgeSpec {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  params: EdgeParams;
}

export type ScenarioKind =
  | 'constant'
  | 'wander'
  | 'ramp'
  | 'diurnal'
  | 'spike'
  | 'thunderingHerd';

/**
 * How offered load is specified:
 *  - 'rps'   open loop — a fixed request rate arrives regardless of response time
 *  - 'users' closed loop — a fixed population of users each sends a request, waits
 *            for the reply, thinks for `thinkTimeSec`, and repeats. Effective
 *            rate self-limits as the system slows (interactive response-time law
 *            λ = N / (R + Z)).
 */
export type LoadMode = 'rps' | 'users';

export interface ScenarioConfig {
  kind: ScenarioKind;
  /** How load is specified. Defaults to 'rps' when omitted. */
  mode?: LoadMode;
  /** Baseline / target requests per second (rps mode, and the resolved rate in users mode). */
  targetRps: number;
  /** Concurrent user population (users mode). Defaults to 0. */
  users?: number;
  /** Mean seconds a user waits between reply and next request (users mode). Defaults to 1. */
  thinkTimeSec?: number;
  /** Scenario length in seconds of simulated time. */
  durationSec: number;
  /** Peak multiplier for ramp / spike / herd (e.g. 8 = 8× baseline at peak). */
  peakFactor?: number;
}

export interface SimConfig {
  scenario: ScenarioConfig;
  /** PRNG seed — same seed + design ⇒ identical DES run. */
  seed: number;
  /** Simulated seconds advanced per wall-clock second while playing. */
  speed: number;
}

export interface SystemDesign {
  /** Schema version for migrations. */
  version: number;
  name: string;
  description?: string;
  notes?: string;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  sim: SimConfig;
}

export const DESIGN_SCHEMA_VERSION = 1;

/** Per-node steady-state metrics produced by the analytical solver. */
export interface NodeMetrics {
  /** Offered arrival rate into the node (after upstream routing + retries). */
  arrivalRate: number;
  /** Requests per second actually served (arrivalRate − dropped). */
  throughput: number;
  /** Utilization per server, ρ = λ/(cμ). */
  rho: number;
  /** Effective server/replica count used in the model. */
  servers: number;
  /** Mean number in system / in queue. */
  inSystem: number;
  inQueue: number;
  /** Latency through this node alone, seconds. */
  latency: { mean: number; p50: number; p95: number; p99: number };
  /** Fraction of offered requests dropped here (queue full / shed). */
  dropRate: number;
  /** Fraction of served requests that error (intrinsic + downstream-induced). */
  errorRate: number;
  /** ρ < 1 (or bounded). */
  stable: boolean;
  /** ρ ≥ 1 with an unbounded queue — steady state undefined. */
  overloaded: boolean;
  /** Backlog growth rate (req/s) when overloaded, else 0. */
  backlogGrowth: number;
  /** Per-instance breakdown for composite components (DB replicas, shards). */
  members?: MemberMetrics[];
  /** Steady-state / live state of a circuit breaker node (only that type sets it). */
  breakerState?: BreakerState;
}

/** Circuit-breaker lifecycle state. */
export type BreakerState = 'closed' | 'open' | 'half-open';

/** One instance inside a composite component (a DB replica, a shard, …). */
export interface MemberMetrics {
  /** Machine role, e.g. "primary", "read replica", "shard". */
  role: string;
  /** Display label, e.g. "primary", "replica 2", "shard 3". */
  label: string;
  arrivalRate: number;
  rho: number;
  latencyP99: number;
  dropRate: number;
  /** Running significantly hotter than its peers (skewed shard / unbalanced). */
  hot?: boolean;
}

export interface ExplainNote {
  /** Which metric this explains, e.g. "latency.p99", "dropRate". */
  metric: string;
  /** Plain-English sentence. */
  text: string;
  /** The formula applied, as a short string. */
  formula?: string;
  /** The term that dominates the result right now. */
  dominantTerm?: string;
}

export interface NodeResult {
  metrics: NodeMetrics;
  explain: ExplainNote[];
}

export interface EdgeMetrics {
  /** Requests per second traversing the edge (includes retry attempts). */
  flow: number;
  /** Retry amplification factor applied on this edge (1 = none). */
  retryFactor: number;
  /** Network latency contribution, seconds. */
  netLatencySec: number;
  /** Fraction of attempts on this edge that exceed `timeoutSec` (0 when no timeout). */
  timeoutRate: number;
}

export interface SystemMetrics {
  offeredRps: number;
  servedRps: number;
  /** End-to-end latency along the critical (slowest) client→sink path. */
  latency: { mean: number; p50: number; p95: number; p99: number };
  /** Overall success fraction across all offered requests. */
  successRate: number;
  /** Any node overloaded. */
  healthy: boolean;
}

export interface SolveWarning {
  level: 'info' | 'warn' | 'error';
  nodeId?: string;
  message: string;
}

export interface SolveResult {
  perNode: Record<string, NodeResult>;
  perEdge: Record<string, EdgeMetrics>;
  system: SystemMetrics;
  warnings: SolveWarning[];
  /** Fixed-point iterations the flow solver needed (diagnostic). */
  iterations: number;
  converged: boolean;
}
