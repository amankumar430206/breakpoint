import type { ComponentType } from '@/engine';

/**
 * The System Design Wiki content model. One `ComponentDoc` per component type,
 * one `ConceptDoc` per cross-cutting pattern. Rendered on the standalone
 * `/wiki/` page and, in `dense` form, in the Node details → Concept sub-tab.
 *
 * All prose is original. Sources are cited only under `further` — nothing is
 * copied from any course or book.
 */

export type Cluster =
  | 'edge'
  | 'compute'
  | 'data'
  | 'messaging'
  | 'coordination'
  | 'resilience'
  | 'external';

export const CLUSTER_LABEL: Record<Cluster, string> = {
  edge: 'Edge & traffic',
  compute: 'Compute',
  data: 'Data & storage',
  messaging: 'Messaging & streaming',
  coordination: 'Coordination',
  resilience: 'Resilience patterns',
  external: 'External services',
};

/** Order the clusters appear in the wiki rail. */
export const CLUSTER_ORDER: Cluster[] = [
  'edge',
  'compute',
  'data',
  'messaging',
  'coordination',
  'resilience',
  'external',
];

export interface Link {
  label: string;
  url: string;
}

export interface Pairing {
  type: ComponentType;
  /** What the partner protects this component from, or what it unlocks. */
  why: string;
}

/**
 * The 10-field explainer. Field order is a learning arc:
 * why → how → when → what breaks → how you'd know → how big →
 * what it needs beside it → how people blow it → go deeper.
 *
 * Strings may use lightweight inline markup handled by `InlineText`:
 * `**bold**`, `` `code` ``, and blank lines as paragraph breaks.
 */
export interface ComponentDoc {
  type: ComponentType;
  cluster: Cluster;
  /** One-sentence definition, no jargon-chaining. */
  tagline: string;
  /** The tension / competing forces that make you reach for it. */
  problem: string;
  /** Core mechanism, then the small set of variants and knobs (the design space). */
  mechanism: string;
  /** Conditions that favour it + the nearest alternative and what you trade. */
  whenToUse: string;
  /** What breaks, in what order, under load; how the failure reaches neighbours. */
  failure: string;
  /** Four Golden Signals instantiated + a few component-specific readings. */
  metrics: string[];
  /** Rough numbers / limits so it isn't treated as infinite. */
  capacity: string;
  /** 2–4 partners, each with the pairing rationale. */
  pairedWith: Pairing[];
  /** 3–6 callouts — where people get it wrong. */
  mistakes: string[];
  /** Slugs into `CONCEPT_DOCS`. */
  concepts: string[];
  further: Link[];
}

export interface ConceptDoc {
  slug: string;
  title: string;
  cluster: Cluster;
  /** Definition → mechanism. Blank lines split paragraphs. */
  body: string;
  /** The "use it when…" line. */
  useWhen: string;
  relatedComponents: ComponentType[];
  further: Link[];
}
