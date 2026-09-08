import { describe, expect, it } from 'vitest';
import { applyFaults, faultId, type Fault } from './faults';
import { solve } from './solver';
import { Simulator } from './des/simulator';
import type { EdgeSpec, NodeSpec, SystemDesign } from './types';

function node(id: string, type: NodeSpec['type'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, type, position: { x: 0, y: 0 }, label: id, params };
}
function edge(id: string, source: string, target: string, params: EdgeSpec['params'] = {}): EdgeSpec {
  return { id, source, target, params };
}
function design(nodes: NodeSpec[], edges: EdgeSpec[], targetRps: number): SystemDesign {
  return {
    version: 1,
    name: 'faults',
    nodes,
    edges,
    sim: { scenario: { kind: 'constant', targetRps, durationSec: 1e6 }, seed: 3, speed: 1 },
  };
}
const F = (kind: Fault['kind'], targetId: string, magnitude?: number): Fault => ({
  id: faultId(kind, targetId),
  kind,
  targetId,
  magnitude,
});

const chain = () =>
  design(
    [
      node('c', 'client'),
      node('lb', 'loadBalancer', { capacityRps: 100000 }),
      node('api', 'apiServer', { serviceTimeMs: 20, concurrency: 16, replicas: 4, intrinsicErrorRate: 0 }),
      node('db', 'sqlDatabase', { architecture: 'single', queryTimeMs: 4, poolSize: 200, intrinsicErrorRate: 0 }),
    ],
    [edge('e1', 'c', 'lb'), edge('e2', 'lb', 'api'), edge('e3', 'api', 'db')],
    600,
  );

describe('applyFaults', () => {
  it('kill drops the node and every edge touching it', () => {
    const d = applyFaults(chain(), [F('kill', 'api')]);
    expect(d.nodes.map((n) => n.id)).not.toContain('api');
    expect(d.edges.map((e) => e.id).sort()).toEqual(['e1']); // e2, e3 both touched api
  });

  it('kill makes the downstream unreachable in the solve', () => {
    const base = solve(chain());
    const killed = solve(applyFaults(chain(), [F('kill', 'api')]));
    expect(base.perNode.db.metrics.arrivalRate).toBeGreaterThan(0);
    // the DB node survives but is orphaned — no traffic reaches it
    expect(killed.perNode.api).toBeUndefined();
    expect(killed.perNode.db.metrics.arrivalRate).toBe(0);
  });

  it('partition cuts one edge and starves what was behind it', () => {
    const d = applyFaults(chain(), [F('partition', 'e3')]);
    expect(d.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
    const r = solve(d);
    expect(r.perNode.db.metrics.arrivalRate).toBe(0);
  });

  it('slow inflates the dominant service-time param', () => {
    const d = applyFaults(chain(), [F('slow', 'db', 500)]);
    expect(d.nodes.find((n) => n.id === 'db')!.params.queryTimeMs).toBe(504);
    const base = solve(chain()).perNode.db.metrics.latency.p99;
    const slow = solve(d).perNode.db.metrics.latency.p99;
    expect(slow).toBeGreaterThan(base + 0.4);
  });

  it('degrade raises the node error rate and the system error rate', () => {
    const d = applyFaults(chain(), [F('degrade', 'db', 0.3)]);
    expect(d.nodes.find((n) => n.id === 'db')!.params.intrinsicErrorRate).toBeCloseTo(0.3, 6);
    const base = solve(chain()).system.successRate;
    const degraded = solve(d).system.successRate;
    expect(degraded).toBeLessThan(base - 0.2);
  });

  it('is a no-op with no faults and does not mutate the input', () => {
    const d = chain();
    const snapshot = JSON.stringify(d);
    expect(applyFaults(d, [])).toBe(d);
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('stacks faults — degrade + slow on the same node', () => {
    const d = applyFaults(chain(), [F('slow', 'api', 100), F('degrade', 'api', 0.1)]);
    const api = d.nodes.find((n) => n.id === 'api')!;
    expect(api.params.serviceTimeMs).toBe(120);
    expect(api.params.intrinsicErrorRate).toBeCloseTo(0.1, 6);
  });

  it('keeps the analytical and DES engines in agreement under a degrade fault', () => {
    const d = applyFaults(chain(), [F('degrade', 'db', 0.2)]);
    const sim = new Simulator(d);
    sim.advance(120);
    sim.snapshot();
    sim.advance(120 + 400);
    const s = sim.snapshot();
    const a = solve(d);
    // both engines see the same overlaid design → same ballpark error + rho
    expect(Math.abs(s.system.successRate - a.system.successRate)).toBeLessThan(0.06);
    expect(Math.abs(s.perNode.api.rho - a.perNode.api.metrics.rho)).toBeLessThan(0.08);
  });
});
