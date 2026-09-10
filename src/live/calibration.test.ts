import { describe, expect, it } from 'vitest';
import type { NodeSpec, SystemDesign } from '@/engine';
import { applyCalibration, type CalibrationMap } from './calibration';

function node(id: string, type: NodeSpec['type'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, type, position: { x: 0, y: 0 }, label: id, params };
}
function design(nodes: NodeSpec[]): SystemDesign {
  return {
    version: 1,
    name: 't',
    nodes,
    edges: [],
    sim: { scenario: { kind: 'constant', targetRps: 10, durationSec: 1e6 }, seed: 1, speed: 1 },
  };
}

describe('applyCalibration', () => {
  it('is identity for an empty map', () => {
    const d = design([node('a', 'apiServer', { serviceTimeMs: 40 })]);
    expect(applyCalibration(d, {})).toBe(d);
  });

  it('writes serviceTimeMs + intrinsicErrorRate on an apiServer', () => {
    const d = design([node('a', 'apiServer', { serviceTimeMs: 40, intrinsicErrorRate: 0.001, vcpus: 4 })]);
    const cal: CalibrationMap = { a: { serviceTimeMs: 73, errorRate: 0.05 } };
    const out = applyCalibration(d, cal);
    expect(out).not.toBe(d);
    expect(out.nodes[0].params.serviceTimeMs).toBe(73);
    expect(out.nodes[0].params.intrinsicErrorRate).toBe(0.05);
    expect(out.nodes[0].params.vcpus).toBe(4); // untouched
    // original design object not mutated
    expect(d.nodes[0].params.serviceTimeMs).toBe(40);
  });

  it('maps to latencyMs / errorRate on an externalService', () => {
    const d = design([node('x', 'externalService', { latencyMs: 120, errorRate: 0.01 })]);
    const out = applyCalibration(d, { x: { serviceTimeMs: 250, errorRate: 0.2 } });
    expect(out.nodes[0].params.latencyMs).toBe(250);
    expect(out.nodes[0].params.errorRate).toBe(0.2);
  });

  it('clamps error rate to [0,1] and service time to > 0', () => {
    const d = design([node('a', 'apiServer', {})]);
    const out = applyCalibration(d, { a: { serviceTimeMs: -5, errorRate: 3 } });
    expect(out.nodes[0].params.serviceTimeMs).toBe(0.1);
    expect(out.nodes[0].params.intrinsicErrorRate).toBe(1);
  });

  it('skips node types it cannot calibrate', () => {
    const d = design([node('c', 'cache', { hitLatencyMs: 1 })]);
    expect(applyCalibration(d, { c: { serviceTimeMs: 99 } })).toBe(d);
  });

  it('ignores a calibration entry for a missing node', () => {
    const d = design([node('a', 'apiServer', { serviceTimeMs: 40 })]);
    expect(applyCalibration(d, { ghost: { serviceTimeMs: 10 } })).toBe(d);
  });
});
