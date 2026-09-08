import { buildGraph, topoOrder, type Graph } from '../flow';
import { getModel } from '../registry';
import { mulberry32, type Rng } from '../rng';
import { arrivalRate, maxArrivalRate } from './scenarios';
import { Histogram } from './histogram';
import { MinHeap } from './heap';
import type { SystemDesign } from '../types';
import type { SimSpec } from '../components/types';

export interface SimNodeMetrics {
  arrivalRate: number;
  throughput: number;
  dropRate: number;
  errorRate: number;
  rho: number;
  inQueue: number;
  inSystem: number;
  servers: number;
  latency: { mean: number; p50: number; p95: number; p99: number };
  overloaded: boolean;
  backlogGrowth: number;
}

export interface SimSnapshot {
  simTime: number;
  perNode: Record<string, SimNodeMetrics>;
  perEdge: Record<string, { flow: number; retryFactor: number; timeoutRate: number }>;
  system: {
    offeredRps: number;
    servedRps: number;
    successRate: number;
    latency: { mean: number; p50: number; p95: number; p99: number };
  };
}

const MAX_QUEUE = 100_000; // guard against OOM on unbounded overload
const MAX_EVENTS_PER_ADVANCE = 2_000_000;

interface Req {
  id: number;
  bornAt: number;
  enteredNodeAt: number;
  onResolve: (failed: boolean, at: number) => void;
}

interface SimNode {
  id: string;
  isClient: boolean;
  spec: SimSpec;
  out: {
    edgeId: string;
    target: string;
    weight: number;
    retries: number;
    backoff: number;
    calls: number;
    timeoutSec: number;
    netSec: number;
  }[];
  routing: 'passthrough' | 'replicate' | 'branch' | 'sink';
  busy: number;
  queue: Req[];
  // window counters
  arrivals: number;
  completions: number;
  drops: number;
  errors: number;
  hist: Histogram;
  // time-integrated occupancy (updated lazily on each state change via touch())
  busyArea: number;
  queueArea: number;
  lastChange: number;
}

export class Simulator {
  private g: Graph;
  private rng: Rng;
  private heap = new MinHeap<() => void>();
  private nodes = new Map<string, SimNode>();
  private clients: string[] = [];
  private edgeAttempts = new Map<string, number>();
  private edgeFirst = new Map<string, number>();
  private edgeTimeouts = new Map<string, number>();
  private now = 0;
  private windowStart = 0;
  private reqSeq = 0;
  private nextArrivalScheduled = false;
  private usersStarted = false;
  private readonly closedLoop: boolean;
  private readonly userCount: number;
  private readonly thinkTime: number;

  // system window counters
  private sysOffered = 0;
  private sysServed = 0;
  private sysHist = new Histogram();

  readonly valid: boolean;

  constructor(private design: SystemDesign) {
    const usable = design.nodes.filter((n) => {
      try {
        getModel(n.type);
        return true;
      } catch {
        return false;
      }
    });
    this.g = buildGraph(usable, design.edges);
    this.valid = topoOrder(this.g) !== null && usable.length > 0;
    this.rng = mulberry32(design.sim.seed >>> 0);

    const sc = design.sim.scenario;
    this.closedLoop = sc.mode === 'users';
    this.userCount = Math.max(0, Math.floor(sc.users ?? 0));
    this.thinkTime = Math.max(1e-3, sc.thinkTimeSec ?? 1);

    for (const n of usable) {
      const model = getModel(n.type);
      const spec = model.simSpec(n.params);
      const outs = (this.g.outEdges.get(n.id) ?? []).map((e) => ({
        edgeId: e.id,
        target: e.target,
        weight: e.params.weight ?? 1,
        retries: Math.max(0, Math.floor(e.params.retries ?? 0)),
        backoff: Math.max(0, e.params.backoffSec ?? 0),
        calls: Math.max(0, e.params.callsPerRequest ?? 1),
        timeoutSec: Math.max(0, e.params.timeoutSec ?? 0),
        netSec: Math.max(0, e.params.netLatencyMs ?? 0) / 1000,
      }));
      this.nodes.set(n.id, {
        id: n.id,
        isClient: n.type === 'client',
        spec,
        out: outs,
        routing: model.routing,
        busy: 0,
        queue: [],
        arrivals: 0,
        completions: 0,
        drops: 0,
        errors: 0,
        hist: new Histogram(),
        busyArea: 0,
        queueArea: 0,
        lastChange: 0,
      });
      if (n.type === 'client') this.clients.push(n.id);
      for (const e of this.g.outEdges.get(n.id) ?? []) {
        this.edgeAttempts.set(e.id, 0);
        this.edgeFirst.set(e.id, 0);
        this.edgeTimeouts.set(e.id, 0);
      }
    }
  }

  /** Advance simulated time to `untilSimTime`, processing events in order. */
  advance(untilSimTime: number): void {
    if (!this.valid) return;
    if (this.closedLoop) {
      if (!this.usersStarted) this.startUsers();
    } else if (!this.nextArrivalScheduled) {
      this.scheduleNextArrival();
    }

    let processed = 0;
    while (this.heap.size > 0 && (this.heap.peekKey() ?? Infinity) <= untilSimTime) {
      if (processed++ > MAX_EVENTS_PER_ADVANCE) break;
      const t = this.heap.peekKey()!;
      const fn = this.heap.pop()!;
      this.now = t;
      fn();
    }
    this.now = untilSimTime;
  }

  /** Fold elapsed occupancy into the running integrals before mutating a node. */
  private touch(n: SimNode): void {
    const dt = this.now - n.lastChange;
    if (dt > 0) {
      n.busyArea += n.busy * dt;
      n.queueArea += n.queue.length * dt;
      n.lastChange = this.now;
    }
  }

  private at(delay: number, fn: () => void): void {
    this.heap.push(this.now + Math.max(0, delay), fn);
  }

  private scheduleNextArrival(): void {
    const sc = this.design.sim.scenario;
    const lambdaMax = maxArrivalRate(sc);
    if (lambdaMax <= 0 || this.clients.length === 0) {
      this.nextArrivalScheduled = false;
      return;
    }
    this.nextArrivalScheduled = true;
    // Non-homogeneous Poisson via thinning.
    const gap = this.rng.exponential(lambdaMax * this.clients.length);
    this.at(gap, () => {
      const rate = arrivalRate(sc, this.now) * this.clients.length;
      if (this.rng.next() < rate / (lambdaMax * this.clients.length)) {
        const client = this.clients[(this.rng.next() * this.clients.length) | 0];
        this.spawn(client);
      }
      this.scheduleNextArrival();
    });
  }

  private spawn(clientId: string, onDone?: () => void): void {
    const born = this.now;
    this.sysOffered += 1;
    const req: Req = {
      id: ++this.reqSeq,
      bornAt: born,
      enteredNodeAt: born,
      onResolve: (failed, at) => {
        if (!failed) {
          this.sysServed += 1;
          this.sysHist.record(at - born);
        }
        onDone?.();
      },
    };
    // Client is an infinite-server pass-through: route immediately.
    this.routeDownstream(this.nodes.get(clientId)!, req, this.now);
  }

  /** Closed loop: a fixed population of users, each sending, waiting for the
   *  reply, thinking, and repeating. Effective rate self-limits under load. */
  private startUsers(): void {
    this.usersStarted = true;
    if (this.clients.length === 0 || this.userCount === 0) return;
    for (let i = 0; i < this.userCount; i++) {
      const client = this.clients[i % this.clients.length];
      // stagger initial requests across a think time to avoid a t=0 herd
      this.at(this.rng.next() * this.thinkTime, () => this.userLoop(client));
    }
  }

  private userLoop(clientId: string): void {
    this.spawn(clientId, () => {
      this.at(this.rng.exponential(1 / this.thinkTime), () => this.userLoop(clientId));
    });
  }

  private arrive(node: SimNode, req: Req): void {
    node.arrivals += 1;
    req.enteredNodeAt = this.now;

    if (node.busy < node.spec.servers) {
      this.touch(node);
      node.busy += 1;
      this.startService(node, req);
    } else if (node.queue.length < Math.min(node.spec.queueCap, MAX_QUEUE)) {
      this.touch(node);
      node.queue.push(req);
    } else {
      node.drops += 1;
      req.onResolve(true, this.now);
    }
  }

  private startService(node: SimNode, req: Req): void {
    const svc =
      node.spec.serviceRate === Infinity ? 0 : this.rng.exponential(node.spec.serviceRate);
    this.at(svc, () => this.serviceComplete(node, req));
  }

  /** A service slot finishes: free it, admit the next waiter, and let the
   *  request continue after any fixed pipeline latency (which does NOT hold the
   *  slot — that is a network hop, not server occupancy). */
  private serviceComplete(node: SimNode, req: Req): void {
    this.touch(node);
    node.busy -= 1;
    const next = node.queue.shift();
    if (next) {
      node.busy += 1;
      this.startService(node, next);
    }

    if (node.spec.fixedLatencySec > 0) {
      this.at(node.spec.fixedLatencySec, () => this.finishNode(node, req));
    } else {
      this.finishNode(node, req);
    }
  }

  private finishNode(node: SimNode, req: Req): void {
    node.completions += 1;
    node.hist.record(this.now - req.enteredNodeAt);

    const errored = node.spec.errorRate > 0 && this.rng.next() < node.spec.errorRate;
    if (errored) {
      node.errors += 1;
      req.onResolve(true, this.now);
    } else {
      this.routeDownstream(node, req, this.now);
    }
  }

  private routeDownstream(node: SimNode, req: Req, at: number): void {
    // Branch nodes (cache/CDN): short-circuit unless we take the downstream path.
    if (node.routing === 'branch') {
      const cont = this.rng.next() < node.spec.branchProb;
      if (!cont || node.out.length === 0) {
        req.onResolve(false, at);
        return;
      }
    }
    if (node.out.length === 0 || node.routing === 'sink') {
      req.onResolve(false, at);
      return;
    }

    const targets =
      node.routing === 'replicate'
        ? node.out
        : [this.pickWeighted(node.out)];

    let remaining = targets.length;
    let anyFailed = false;
    let lastAt = at;
    const branchDone = (failed: boolean, t: number) => {
      remaining -= 1;
      anyFailed = anyFailed || failed;
      lastAt = Math.max(lastAt, t);
      if (remaining === 0) req.onResolve(anyFailed, lastAt);
    };

    for (const tgt of targets) {
      const fanout = Math.max(1, Math.round(tgt.calls));
      let fanRemaining = fanout;
      let fanFailed = false;
      let fanAt = at;
      const fanDone = (failed: boolean, t: number) => {
        fanRemaining -= 1;
        fanFailed = fanFailed || failed;
        fanAt = Math.max(fanAt, t);
        if (fanRemaining === 0) branchDone(fanFailed, fanAt);
      };
      for (let i = 0; i < fanout; i++) this.sendAlong(tgt, req.bornAt, 1, fanDone);
    }
  }

  private sendAlong(
    tgt: SimNode['out'][number],
    bornAt: number,
    attempt: number,
    resolve: (failed: boolean, at: number) => void,
  ): void {
    this.edgeAttempts.set(tgt.edgeId, (this.edgeAttempts.get(tgt.edgeId) ?? 0) + 1);
    if (attempt === 1) this.edgeFirst.set(tgt.edgeId, (this.edgeFirst.get(tgt.edgeId) ?? 0) + 1);

    const targetNode = this.nodes.get(tgt.target);
    if (!targetNode) return resolve(false, this.now);

    // Whichever fires first — the downstream subtree resolving, or the per-attempt
    // timeout — settles this attempt; the other is ignored. An abandoned request
    // still occupies the downstream server (wasted work), matching reality.
    let settled = false;
    const done = (failed: boolean, at: number): void => {
      if (settled) return;
      settled = true;
      if (failed && attempt <= tgt.retries) {
        this.at(tgt.backoff, () => this.sendAlong(tgt, bornAt, attempt + 1, resolve));
      } else {
        resolve(failed, at);
      }
    };

    const sub: Req = {
      id: ++this.reqSeq,
      bornAt,
      enteredNodeAt: this.now,
      onResolve: (failed, at) => done(failed, at),
    };

    if (tgt.timeoutSec > 0) {
      this.at(tgt.timeoutSec, () => {
        if (settled) return;
        this.edgeTimeouts.set(tgt.edgeId, (this.edgeTimeouts.get(tgt.edgeId) ?? 0) + 1);
        done(true, this.now);
      });
    }

    // Fixed network hop before the request reaches the downstream station.
    if (tgt.netSec > 0) this.at(tgt.netSec, () => this.arrive(targetNode, sub));
    else this.arrive(targetNode, sub);
  }

  private pickWeighted(outs: SimNode['out']): SimNode['out'][number] {
    const total = outs.reduce((s, o) => s + o.weight, 0) || outs.length;
    let r = this.rng.next() * total;
    for (const o of outs) {
      r -= o.weight;
      if (r <= 0) return o;
    }
    return outs[outs.length - 1];
  }

  /** Read metrics for the elapsed window and reset window counters. */
  snapshot(): SimSnapshot {
    const window = Math.max(1e-6, this.now - this.windowStart);
    const perNode: Record<string, SimNodeMetrics> = {};

    for (const n of this.nodes.values()) {
      this.touch(n);
      const servers = Number.isFinite(n.spec.servers) ? n.spec.servers : 1;
      const rho = n.isClient || !Number.isFinite(n.spec.servers) ? 0 : n.busyArea / (servers * window);
      const offered = n.arrivals / window;
      const served = n.completions / window;
      const dropRate = n.arrivals > 0 ? n.drops / n.arrivals : 0;
      const errorRate = n.completions > 0 ? n.errors / n.completions : 0;
      const backlog = n.queue.length;

      perNode[n.id] = {
        arrivalRate: offered,
        throughput: served * (1 - errorRate),
        dropRate,
        errorRate,
        rho,
        inQueue: n.queueArea / window,
        inSystem: (n.busyArea + n.queueArea) / window,
        servers,
        latency: {
          mean: n.hist.mean,
          p50: n.hist.quantile(0.5),
          p95: n.hist.quantile(0.95),
          p99: n.hist.quantile(0.99),
        },
        overloaded: rho >= 0.98 || backlog > 5000,
        backlogGrowth: backlog > 5000 ? Math.max(0, offered - served) : 0,
      };

      n.arrivals = n.completions = n.drops = n.errors = 0;
      n.busyArea = n.queueArea = 0;
      n.lastChange = this.now;
      n.hist.reset();
    }

    const perEdge: Record<string, { flow: number; retryFactor: number; timeoutRate: number }> = {};
    for (const [id, attempts] of this.edgeAttempts) {
      const first = this.edgeFirst.get(id) ?? 0;
      const timeouts = this.edgeTimeouts.get(id) ?? 0;
      perEdge[id] = {
        flow: attempts / window,
        retryFactor: first > 0 ? attempts / first : 1,
        timeoutRate: attempts > 0 ? timeouts / attempts : 0,
      };
      this.edgeAttempts.set(id, 0);
      this.edgeFirst.set(id, 0);
      this.edgeTimeouts.set(id, 0);
    }

    const offeredRps = this.sysOffered / window;
    const servedRps = this.sysServed / window;
    const snap: SimSnapshot = {
      simTime: this.now,
      perNode,
      perEdge,
      system: {
        offeredRps,
        servedRps,
        // clamp: within a window, requests admitted earlier can complete now,
        // which can nudge served/offered just past 1.
        successRate: this.sysOffered > 0 ? Math.min(1, this.sysServed / this.sysOffered) : 1,
        latency: {
          mean: this.sysHist.mean,
          p50: this.sysHist.quantile(0.5),
          p95: this.sysHist.quantile(0.95),
          p99: this.sysHist.quantile(0.99),
        },
      },
    };

    this.sysOffered = 0;
    this.sysServed = 0;
    this.sysHist.reset();
    this.windowStart = this.now;
    return snap;
  }

  get simTime(): number {
    return this.now;
  }
}
