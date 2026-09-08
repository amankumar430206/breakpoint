import type { SystemDesign } from '@/engine';
import urlShortener from './url-shortener.json';
import ecommerce from './ecommerce-checkout.json';
import socialFeed from './social-feed.json';
import streamingCdn from './streaming-cdn.json';
import publicApi from './public-api.json';
import singleBox from './single-box.json';

export interface PresetEntry {
  id: string;
  design: SystemDesign;
}

/** Built-in preset library. Each JSON is validated on load in `lib/serialize.ts`. */
export const PRESETS: PresetEntry[] = [
  { id: 'url-shortener', design: urlShortener as SystemDesign },
  { id: 'ecommerce-checkout', design: ecommerce as SystemDesign },
  { id: 'social-feed', design: socialFeed as SystemDesign },
  { id: 'streaming-cdn', design: streamingCdn as SystemDesign },
  { id: 'public-api', design: publicApi as SystemDesign },
  { id: 'single-box', design: singleBox as SystemDesign },
];

export function getPreset(id: string): SystemDesign | undefined {
  return PRESETS.find((p) => p.id === id)?.design;
}

export const DEFAULT_PRESET_ID = 'url-shortener';
