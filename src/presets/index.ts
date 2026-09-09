import type { SystemDesign } from '@/engine';
import starter from './starter.json';
import urlShortener from './url-shortener.json';
import singleBox from './single-box.json';
import publicApi from './public-api.json';
import ecommerce from './ecommerce-checkout.json';
import socialFeed from './social-feed.json';
import streamingCdn from './streaming-cdn.json';
import saasApi from './saas-api.json';
import newsSite from './news-site.json';
import eventDrivenOrders from './event-driven-orders.json';
import metricsPipeline from './metrics-pipeline.json';

export interface PresetEntry {
  id: string;
  design: SystemDesign;
}

/** Built-in preset library — ordered simplest → most involved. Each JSON is
 *  validated on load in `lib/serialize.ts` and structurally in presets.test.ts.
 *  They double as worked examples of how each component is wired. */
export const PRESETS: PresetEntry[] = [
  { id: 'starter', design: starter as SystemDesign },
  { id: 'single-box', design: singleBox as SystemDesign },
  { id: 'url-shortener', design: urlShortener as SystemDesign },
  { id: 'public-api', design: publicApi as SystemDesign },
  { id: 'ecommerce-checkout', design: ecommerce as SystemDesign },
  { id: 'social-feed', design: socialFeed as SystemDesign },
  { id: 'streaming-cdn', design: streamingCdn as SystemDesign },
  { id: 'saas-api', design: saasApi as SystemDesign },
  { id: 'news-site', design: newsSite as SystemDesign },
  { id: 'event-driven-orders', design: eventDrivenOrders as SystemDesign },
  { id: 'metrics-pipeline', design: metricsPipeline as SystemDesign },
];

export function getPreset(id: string): SystemDesign | undefined {
  return PRESETS.find((p) => p.id === id)?.design;
}

export const DEFAULT_PRESET_ID = 'url-shortener';
