import { describe, expect, it } from 'vitest';
import { advise } from './advise';
import { solve } from './solver';
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
    name: 'advise',
    nodes,
    edges,
    sim: { scenario: { kind: 'constant', targetRps, durationSec: 60 }, seed: 1, speed: 1 },
  };
}
const run = (d: SystemDesign) => advise(d, solve(d));
const topics = (d: SystemDesign) => run(d).map((a) => a.topic);

describe('advise — CAP posture', () => {
  it('flags an async primary-replica store as AP-leaning', () => {
    const d = design(
      [
        node('c', 'client'),
        node('lb', 'loadBalancer'),
        node('api', 'apiServer', { serviceTimeMs: 5, concurrency: 32, replicas: 2 }),
        node('db', 'sqlDatabase', { architecture: 'primary-replica', readReplicas: 2, readRatio: 0.8 }),
      ],
      [edge('e1', 'c', 'lb'), edge('e2', 'lb', 'api'), edge('e3', 'api', 'db')],
      200,
    );
    const cap = run(d).find((a) => a.topic === 'CAP posture');
    expect(cap?.verdict).toMatch(/AP-leaning/);
    expect(cap?.docHref).toContain('concepts.md#');
  });

  it('calls multi-primary CP-leaning', () => {
    const d = design(
      [
        node('c', 'client'),
        node('lb', 'loadBalancer'),
        node('api', 'apiServer', { serviceTimeMs: 5, concurrency: 32, replicas: 2 }),
        node('db', 'sqlDatabase', { architecture: 'multi-primary', primaries: 3 }),
      ],
      [edge('e1', 'c', 'lb'), edge('e2', 'lb', 'api'), edge('e3', 'api', 'db')],
      200,
    );
    expect(run(d).find((a) => a.topic === 'CAP posture')?.verdict).toMatch(/CP-leaning/);
  });
});

describe('advise — structural rules', () => {
  const base = (dbParams: Record<string, unknown>, load = 200, extra: NodeSpec[] = [], extraEdges: EdgeSpec[] = []) =>
    design(
      [
        node('c', 'client'),
        node('lb', 'loadBalancer'),
        node('api', 'apiServer', { serviceTimeMs: 5, concurrency: 64, replicas: 3 }),
        node('db', 'sqlDatabase', dbParams),
        ...extra,
      ],
      [edge('e1', 'c', 'lb'), edge('e2', 'lb', 'api'), edge('e3', 'api', 'db'), ...extraEdges],
      load,
    );

  it('suggests a read replica / cache for a read-heavy single primary', () => {
    const d = base({ architecture: 'single', readRatio: 0.9, poolSize: 200 });
    expect(topics(d)).toContain('Read/write split');
  });

  it('does not suggest a read split when a cache sits in front of the DB', () => {
    const d = base(
      { architecture: 'single', readRatio: 0.9, poolSize: 200 },
      200,
      [node('cache', 'cache', { hitRatio: 0.9 })],
      [edge('e4', 'api', 'cache'), edge('e5', 'cache', 'db')],
    );
    // rewire: api → cache → db (drop the direct api → db edge)
    d.edges = d.edges.filter((e) => e.id !== 'e3');
    expect(topics(d)).not.toContain('Read/write split');
  });

  it('tells a saturated write-bound DB to shard, not replicate', () => {
    const d = base({ architecture: 'primary-replica', readRatio: 0.2, poolSize: 2, queueLimit: 2 }, 4000);
    const shard = run(d).find((a) => a.topic === 'Sharding');
    expect(shard?.verdict).toMatch(/write-bound/);
  });

  it('flags a third-party call with no circuit breaker, and clears it once wrapped', () => {
    const withoutCb = base(
      { architecture: 'primary-replica', readReplicas: 1 },
      200,
      [node('pay', 'externalService', { latencyMs: 200 })],
      [edge('e4', 'api', 'pay')],
    );
    expect(topics(withoutCb)).toContain('Resilience');

    const withCb = base(
      { architecture: 'primary-replica', readReplicas: 1 },
      200,
      [node('cb', 'circuitBreaker'), node('pay', 'externalService', { latencyMs: 200 })],
      [edge('e4', 'api', 'cb'), edge('e5', 'cb', 'pay')],
    );
    expect(topics(withCb)).not.toContain('Resilience');
  });

  it('flags an app tier with no reverse proxy in front', () => {
    const d = design(
      [
        node('c', 'client'),
        node('api', 'apiServer', { serviceTimeMs: 5, concurrency: 32, replicas: 2 }),
        node('db', 'sqlDatabase', { architecture: 'primary-replica', readReplicas: 1 }),
      ],
      [edge('e1', 'c', 'api'), edge('e2', 'api', 'db')],
      200,
    );
    expect(topics(d)).toContain('Reverse proxy');
  });

  it('names the load-balancer algorithm with a when-to-use hint', () => {
    const d = base({ architecture: 'primary-replica', readReplicas: 1 });
    const lb = run(d).find((a) => a.topic === 'Load balancing');
    expect(lb?.verdict).toMatch(/round-robin/);
    expect(lb?.useWhen).toMatch(/least-conn/);
  });

  it('orders warnings before informational notes', () => {
    const d = base({ architecture: 'single', readRatio: 0.95, poolSize: 200 });
    const sevs = run(d).map((a) => a.severity);
    const firstInfo = sevs.indexOf('info');
    const lastWarn = sevs.lastIndexOf('warn');
    if (firstInfo !== -1 && lastWarn !== -1) expect(lastWarn).toBeLessThan(firstInfo);
  });
});
