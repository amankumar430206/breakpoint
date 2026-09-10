// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useProbeStore } from '@/store/probeStore';
import { toDesign, type TmEdge, type TmNode } from './design';
import { serializeDesign } from './serialize';
import { designToHash } from './shareUrl';

/**
 * Regression guard: Live Probe target details (URL, headers, body) may hold
 * credentials and MUST NEVER reach the persisted design document — which is
 * written to localStorage, share-URL hashes and JSON exports. They live only in
 * `probeStore` (in-memory). This test locks that invariant.
 */

const SECRET_URL = 'http://localhost:9999/internal/admin';
const SECRET_HEADER_KEY = 'x-super-secret-token';
const SECRET_HEADER_VAL = 'sk_live_do_not_leak';

function apiNode(): TmNode {
  return {
    id: 'api1',
    type: 'apiServer',
    position: { x: 0, y: 0 },
    data: { label: 'api', params: { serviceTimeMs: 40, vcpus: 2 } },
  };
}

describe('probe target never enters the persisted design', () => {
  it('toDesign / serializeDesign / designToHash carry no probe fields', () => {
    useProbeStore.getState().setTarget('api1', {
      url: SECRET_URL,
      method: 'POST',
      headers: [[SECRET_HEADER_KEY, SECRET_HEADER_VAL]],
      body: '{"password":"hunter2"}',
    });

    const nodes: TmNode[] = [apiNode()];
    const edges: TmEdge[] = [];
    const design = toDesign(nodes, edges, {
      scenario: { kind: 'constant', targetRps: 10, durationSec: 60 },
      seed: 1,
      speed: 4,
    });

    const blobs = [JSON.stringify(design), serializeDesign(design), designToHash(design)];
    for (const blob of blobs) {
      expect(blob).not.toContain(SECRET_URL);
      expect(blob).not.toContain(SECRET_HEADER_KEY);
      expect(blob).not.toContain(SECRET_HEADER_VAL);
      expect(blob).not.toContain('hunter2');
    }
    // the node still serialises its real params
    expect(design.nodes[0].params).toEqual({ serviceTimeMs: 40, vcpus: 2 });
  });

  it('probeStore does not touch localStorage', () => {
    const writes: string[] = [];
    const orig = window.localStorage.setItem.bind(window.localStorage);
    const spy = (k: string, v: string) => {
      writes.push(k);
      orig(k, v);
    };
    window.localStorage.setItem = spy as typeof window.localStorage.setItem;
    try {
      useProbeStore.getState().setTarget('n', { url: SECRET_URL });
      useProbeStore.getState().setConfig({ targetRps: 42 });
      useProbeStore.getState().calibrateFromResult('n');
    } finally {
      window.localStorage.setItem = orig;
    }
    expect(writes).toEqual([]);
  });
});
