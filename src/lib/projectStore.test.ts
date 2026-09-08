// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { SystemDesign } from '@/engine';
import {
  clearProjects,
  deleteProject,
  getProject,
  listProjects,
  newProjectId,
  relativeTime,
  saveProject,
} from './projectStore';

const design = (name: string, nodes = 1): SystemDesign =>
  ({
    version: 1,
    name,
    nodes: Array.from({ length: nodes }, (_, i) => ({
      id: `n${i}`,
      type: 'client',
      position: { x: 0, y: 0 },
      params: {},
    })),
    edges: [],
    sim: { scenario: { kind: 'constant', targetRps: 100, durationSec: 60 }, seed: 1, speed: 4 },
  }) as unknown as SystemDesign;

describe('projectStore', () => {
  beforeEach(() => clearProjects());

  it('saves and reads a project back', () => {
    const id = newProjectId();
    saveProject(design('My API', 3), id);
    const got = getProject(id);
    expect(got?.name).toBe('My API');
    expect(got?.design.nodes).toHaveLength(3);
    expect(got?.updatedAt).toBeGreaterThan(0);
  });

  it('upserts by id and refreshes updatedAt', async () => {
    const id = newProjectId();
    saveProject(design('v1'), id);
    const t1 = getProject(id)!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    saveProject(design('v2'), id);
    expect(listProjects().filter((p) => p.id === id)).toHaveLength(1);
    expect(getProject(id)!.name).toBe('v2');
    expect(getProject(id)!.updatedAt).toBeGreaterThanOrEqual(t1);
  });

  it('lists newest first and deletes', () => {
    const a = newProjectId();
    const b = newProjectId();
    saveProject(design('a'), a);
    saveProject(design('b'), b);
    expect(listProjects()[0].id).toBe(b);
    deleteProject(b);
    expect(listProjects().map((p) => p.id)).toEqual([a]);
  });

  it('caps the library at 40 entries', () => {
    for (let i = 0; i < 50; i++) saveProject(design(`d${i}`), newProjectId());
    expect(listProjects().length).toBe(40);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('tm-projects', '{not json');
    expect(listProjects()).toEqual([]);
  });

  it('relativeTime formats recent stamps', () => {
    expect(relativeTime(Date.now())).toBe('just now');
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe('5m ago');
    expect(relativeTime(Date.now() - 3 * 3600_000)).toBe('3h ago');
  });
});
