import { describe, expect, it } from 'vitest';
import { advise, allModels, solve, type ComponentType } from '@/engine';
import { COMPONENT_DOCS } from './components';
import { CONCEPT_DOCS } from './concepts';
import { parseWikiHash } from './index';

const TYPES = allModels().map((m) => m.type);
const CONCEPT_SLUGS = new Set(Object.keys(CONCEPT_DOCS));
const TYPE_SET = new Set<ComponentType>(TYPES);

function isUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

describe('component docs — coverage', () => {
  it('every registered component has a doc', () => {
    for (const t of TYPES) expect(COMPONENT_DOCS[t], `missing doc for ${t}`).toBeTruthy();
  });

  it('no doc for a type that is not registered', () => {
    for (const t of Object.keys(COMPONENT_DOCS)) {
      expect(TYPE_SET.has(t as ComponentType), `stale doc for ${t}`).toBe(true);
    }
  });

  it('every field is filled', () => {
    for (const t of TYPES) {
      const d = COMPONENT_DOCS[t];
      for (const key of ['tagline', 'problem', 'mechanism', 'whenToUse', 'failure', 'capacity'] as const) {
        expect(d[key].trim().length, `${t}.${key} empty`).toBeGreaterThan(20);
      }
      expect(d.metrics.length, `${t}.metrics`).toBeGreaterThanOrEqual(3);
      expect(d.mistakes.length, `${t}.mistakes`).toBeGreaterThanOrEqual(3);
      expect(d.pairedWith.length, `${t}.pairedWith`).toBeGreaterThanOrEqual(2);
      expect(d.further.length, `${t}.further`).toBeGreaterThanOrEqual(1);
      expect(d.type).toBe(t);
    }
  });

  it('pairings reference real component types', () => {
    for (const t of TYPES) {
      for (const p of COMPONENT_DOCS[t].pairedWith) {
        expect(TYPE_SET.has(p.type), `${t} pairs with unknown ${p.type}`).toBe(true);
        expect(p.why.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('related-concept slugs resolve', () => {
    for (const t of TYPES) {
      for (const slug of COMPONENT_DOCS[t].concepts) {
        expect(CONCEPT_SLUGS.has(slug), `${t} → unknown concept "${slug}"`).toBe(true);
      }
    }
  });

  it('further-reading links are valid URLs', () => {
    for (const t of TYPES) {
      for (const l of COMPONENT_DOCS[t].further) {
        expect(isUrl(l.url), `${t} bad url ${l.url}`).toBe(true);
        expect(l.label.trim().length).toBeGreaterThan(3);
      }
    }
  });
});

describe('concept docs', () => {
  it('slug matches the key and fields are filled', () => {
    for (const [key, d] of Object.entries(CONCEPT_DOCS)) {
      expect(d.slug).toBe(key);
      expect(d.body.trim().length).toBeGreaterThan(40);
      expect(d.useWhen.trim().length).toBeGreaterThan(15);
      expect(d.further.length).toBeGreaterThanOrEqual(1);
      for (const l of d.further) expect(isUrl(l.url), `${key} bad url`).toBe(true);
      for (const t of d.relatedComponents) expect(TYPE_SET.has(t), `${key} → ${t}`).toBe(true);
    }
  });
});

describe('advisor links resolve into the wiki', () => {
  it('every advice docHref is a known concept slug', () => {
    // a design that trips several rules at once
    const design = {
      version: 1,
      name: 't',
      nodes: [
        { id: 'c', type: 'client' as const, position: { x: 0, y: 0 }, params: {} },
        { id: 'api', type: 'apiServer' as const, position: { x: 0, y: 1 }, params: {} },
        {
          id: 'db',
          type: 'sqlDatabase' as const,
          position: { x: 0, y: 2 },
          params: { architecture: 'multi-primary', engine: 'cassandra' },
        },
        { id: 'ext', type: 'externalService' as const, position: { x: 0, y: 3 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 'c', target: 'api', params: {} },
        { id: 'e2', source: 'api', target: 'db', params: {} },
        { id: 'e3', source: 'api', target: 'ext', params: {} },
      ],
      sim: { scenario: { kind: 'constant' as const, targetRps: 100, durationSec: 60 }, seed: 1, speed: 1 },
    };
    const result = solve(design as never);
    const list = advise(design as never, result);
    expect(list.length).toBeGreaterThan(0);
    for (const a of list) {
      expect(CONCEPT_SLUGS.has(a.docHref), `advice "${a.topic}" → unknown slug "${a.docHref}"`).toBe(true);
    }
  });
});

describe('parseWikiHash', () => {
  it('routes components, concepts, pitfalls, and rejects junk', () => {
    expect(parseWikiHash('#component/cache')).toEqual({ kind: 'component', slug: 'cache' });
    expect(parseWikiHash('#concept/backpressure')).toEqual({ kind: 'concept', slug: 'backpressure' });
    expect(parseWikiHash('#pitfalls')).toEqual({ kind: 'pitfalls' });
    expect(parseWikiHash('')).toEqual({ kind: 'pitfalls' });
    expect(parseWikiHash('#component/nonsense')).toBeNull();
    expect(parseWikiHash('#concept/nonsense')).toBeNull();
  });
});
