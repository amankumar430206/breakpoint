import type { SystemDesign } from '@/engine';

/**
 * Browser-local library of saved designs. Everything lives in `localStorage`
 * under one key — no network, no accounts. The current design is auto-saved
 * (debounced) so the "recent" list fills itself; an explicit Save is also
 * available. Downloading a `.json` file is handled separately (serialize.ts).
 */
export interface SavedProject {
  id: string;
  name: string;
  /** epoch ms of the last save */
  updatedAt: number;
  design: SystemDesign;
}

const KEY = 'tm-projects';
const CAP = 40;

// Monotonic stamp so rapid saves (autosave bursts) keep a stable newest-first order.
let lastStamp = 0;
function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

export function newProjectId(): string {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function readAll(): SavedProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (p): p is SavedProject =>
        p && typeof p.id === 'string' && typeof p.name === 'string' && p.design,
    );
  } catch {
    return [];
  }
}

function writeAll(list: SavedProject[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
  } catch {
    /* quota / private mode — keep going without persistence */
  }
}

/** Newest first. */
export function listProjects(): SavedProject[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): SavedProject | undefined {
  return readAll().find((p) => p.id === id);
}

/** Upsert by id. Returns the stored record (with a fresh `updatedAt`). */
export function saveProject(design: SystemDesign, id: string): SavedProject {
  const list = readAll();
  const rec: SavedProject = { id, name: design.name || 'Untitled design', updatedAt: stamp(), design };
  const i = list.findIndex((p) => p.id === id);
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  writeAll(list.sort((a, b) => b.updatedAt - a.updatedAt));
  return rec;
}

export function deleteProject(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}

export function clearProjects(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** "3m ago", "2h ago", "yesterday", "Apr 3". */
export function relativeTime(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return 'yesterday';
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
