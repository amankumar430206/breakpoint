import LZString from 'lz-string';
import type { SystemDesign } from '@/engine';
import { parseDesign } from './serialize';

const PARAM = 'd';

/** Compress a design into a URL hash fragment (`#d=...`). */
export function designToHash(design: SystemDesign): string {
  return `#${PARAM}=${LZString.compressToEncodedURIComponent(JSON.stringify(design))}`;
}

/** Full shareable URL for the current page. */
export function shareUrl(design: SystemDesign): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${designToHash(design)}`;
}

/** Read a design from the current location hash, if present and valid. */
export function designFromHash(hash = window.location.hash): SystemDesign | null {
  const m = hash.replace(/^#/, '').split('&').find((p) => p.startsWith(`${PARAM}=`));
  if (!m) return null;
  const raw = m.slice(PARAM.length + 1);
  const json = LZString.decompressFromEncodedURIComponent(raw);
  if (!json) return null;
  try {
    const res = parseDesign(JSON.parse(json));
    return res.ok ? res.design : null;
  } catch {
    return null;
  }
}
