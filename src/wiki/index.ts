import { allModels, type ComponentType } from '@/engine';
import { COMPONENT_DOCS, getComponentDoc } from './components';
import { CONCEPT_DOCS, getConceptDoc } from './concepts';
import { CLUSTER_LABEL, CLUSTER_ORDER, type Cluster, type ComponentDoc, type ConceptDoc } from './types';

export { COMPONENT_DOCS, getComponentDoc } from './components';
export { CONCEPT_DOCS, getConceptDoc } from './concepts';
export { CLUSTER_LABEL, CLUSTER_ORDER } from './types';
export type { Cluster, ComponentDoc, ConceptDoc, Link, Pairing } from './types';

export interface ClusterGroup {
  cluster: Cluster;
  label: string;
  components: ComponentDoc[];
  concepts: ConceptDoc[];
}

/** Components + concepts grouped by cluster, in rail order. */
export function wikiGroups(): ClusterGroup[] {
  const compByCluster = new Map<Cluster, ComponentDoc[]>();
  for (const m of allModels()) {
    const doc = COMPONENT_DOCS[m.type];
    if (!doc) continue;
    const arr = compByCluster.get(doc.cluster) ?? [];
    arr.push(doc);
    compByCluster.set(doc.cluster, arr);
  }
  const conByCluster = new Map<Cluster, ConceptDoc[]>();
  for (const c of Object.values(CONCEPT_DOCS)) {
    const arr = conByCluster.get(c.cluster) ?? [];
    arr.push(c);
    conByCluster.set(c.cluster, arr);
  }
  return CLUSTER_ORDER.map((cluster) => ({
    cluster,
    label: CLUSTER_LABEL[cluster],
    components: compByCluster.get(cluster) ?? [],
    concepts: (conByCluster.get(cluster) ?? []).sort((a, b) => a.title.localeCompare(b.title)),
  })).filter((g) => g.components.length || g.concepts.length);
}

/** Every "common mistake" across all components — the Pitfalls appendix. */
export function allMistakes(): { type: ComponentType; label: string; mistake: string }[] {
  const out: { type: ComponentType; label: string; mistake: string }[] = [];
  for (const m of allModels()) {
    const doc = COMPONENT_DOCS[m.type];
    if (!doc) continue;
    for (const mistake of doc.mistakes) out.push({ type: m.type, label: m.label, mistake });
  }
  return out;
}

export function componentDocList(): ComponentDoc[] {
  return allModels()
    .map((m) => COMPONENT_DOCS[m.type])
    .filter((d): d is ComponentDoc => !!d);
}

export function conceptDocList(): ConceptDoc[] {
  return Object.values(CONCEPT_DOCS);
}

/** Resolve a `#…` hash to a target. */
export function parseWikiHash(hash: string): { kind: 'component' | 'concept' | 'pitfalls'; slug?: string } | null {
  const h = hash.replace(/^#/, '');
  if (!h || h === 'pitfalls') return { kind: 'pitfalls' };
  const [kind, slug] = h.split('/');
  if (kind === 'component' && slug && getComponentDoc(slug as ComponentType)) {
    return { kind: 'component', slug };
  }
  if (kind === 'concept' && slug && getConceptDoc(slug)) return { kind: 'concept', slug };
  return null;
}
