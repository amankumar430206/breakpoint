import { describe, expect, it } from 'vitest';
import { getModel } from '../registry';
import { solve } from '../solver';
import type { EdgeSpec, NodeSpec, SystemDesign } from '../types';

const m = getModel('pubsubTopic');

function node(id: string, type: NodeSpec['type'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, type, position: { x: 0, y: 0 }, label: id, params };
}
function edge(id: string, source: string, target: string): EdgeSpec {
  return { id, source, target, params: {} };
}
function design(nodes: NodeSpec[], edges: EdgeSpec[], targetRps: number): SystemDesign {
  return {
    version: 1,
    name: 'pubsub',
    nodes,
    edges,
    sim: { scenario: { kind: 'constant', targetRps, durationSec: 60 }, seed: 1, speed: 1 },
  };
}

describe('pubsubTopic', () => {
  it('replicates the full stream to every consumer group', () => {
    expect(m.routing).toBe('replicate');
    expect(m.outflowFraction({})).toBe(1);

    const d = design(
      [
        node('c', 'client'),
        node('api', 'apiServer', { serviceTimeMs: 1, concurrency: 128, replicas: 1 }),
        node('t', 'pubsubTopic', { throughputRps: 100000, consumerGroups: 2 }),
        node('w1', 'worker', { jobTimeMs: 5, vcpus: 8, parallelPerVcpu: 8, replicas: 4 }),
        node('w2', 'worker', { jobTimeMs: 5, vcpus: 8, parallelPerVcpu: 8, replicas: 4 }),
      ],
      [edge('e1', 'c', 'api'), edge('e2', 'api', 't'), edge('e3', 't', 'w1'), edge('e4', 't', 'w2')],
      2000,
    );
    const r = solve(d);
    // each group's worker sees the whole 2000 msg/s — not half
    expect(r.perNode.w1.metrics.arrivalRate).toBeCloseTo(2000, 0);
    expect(r.perNode.w2.metrics.arrivalRate).toBeCloseTo(2000, 0);
  });

  it('contrasts with a work queue, which splits across consumers', () => {
    const mk = (topicType: 'pubsubTopic' | 'queue') =>
      design(
        [
          node('c', 'client'),
          node('api', 'apiServer', { serviceTimeMs: 1, concurrency: 128, replicas: 1 }),
          node('t', topicType, topicType === 'pubsubTopic' ? { throughputRps: 100000 } : { brokerThroughputRps: 100000 }),
          node('w1', 'worker', { jobTimeMs: 5, vcpus: 8, parallelPerVcpu: 8, replicas: 4 }),
          node('w2', 'worker', { jobTimeMs: 5, vcpus: 8, parallelPerVcpu: 8, replicas: 4 }),
        ],
        [edge('e1', 'c', 'api'), edge('e2', 'api', 't'), edge('e3', 't', 'w1'), edge('e4', 't', 'w2')],
        2000,
      );
    const topic = solve(mk('pubsubTopic'));
    const queue = solve(mk('queue'));
    // topic: each worker gets 2000; queue: each worker gets ~1000
    expect(topic.perNode.w1.metrics.arrivalRate).toBeGreaterThan(1800);
    expect(queue.perNode.w1.metrics.arrivalRate).toBeLessThan(1200);
  });

  it('saturates when the publish rate exceeds topic throughput', () => {
    const r = m.solve({
      node: node('t', 'pubsubTopic', {}),
      params: { ...m.defaultParams, throughputRps: 1000 },
      inflow: 5000,
      downstreamErrorRate: 0,
    });
    expect(r.metrics.overloaded).toBe(true);
  });
});
