import { memo, useMemo, useState } from 'react';
import type { SystemDesign } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { toDesign } from '@/lib/design';
import { serializeDesign } from '@/lib/serialize';
import { downloadText, slugify } from '@/lib/download';
import {
  clearProjects,
  deleteProject,
  listProjects,
  newProjectId,
  relativeTime,
  saveProject,
} from '@/lib/projectStore';

function ProjectsMenuInner({
  title,
  currentId,
  hasDesign,
  onOpen,
  onSaved,
}: {
  title: string;
  currentId: string | null;
  hasDesign: boolean;
  onOpen: (design: SystemDesign, id: string) => void;
  onSaved: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  // Only touch localStorage while the menu is open (this component is a child of
  // the top bar, which re-renders with every sim snapshot). `tick` is a manual
  // invalidation bumped after save / delete.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const projects = useMemo(() => (open ? listProjects() : []), [open, tick]);

  const currentDesign = (): SystemDesign => {
    const { nodes, edges } = useDesignStore.getState();
    const { scenario, seed, speed } = useSimStore.getState();
    return toDesign(nodes, edges, { scenario, seed, speed }, { name: title });
  };
  const say = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 1600);
  };

  const save = () => {
    const id = currentId ?? newProjectId();
    saveProject(currentDesign(), id);
    onSaved(id);
    setTick((t) => t + 1);
    say('Saved to this browser');
  };
  const download = () => {
    const d = currentDesign();
    downloadText(`${slugify(d.name)}.json`, serializeDesign(d), 'application/json');
    setOpen(false);
  };

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-2 py-1 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn-hover)]"
        title="Saved designs — stored in this browser"
      >
        Projects ▾
      </button>
      {flash && (
        <div className="absolute right-0 top-full z-[60] mt-1 whitespace-nowrap rounded bg-[var(--tm-good-bg)] px-2 py-1 text-[10px] text-[var(--tm-good-fg)]">
          {flash}
        </div>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-[260px] overflow-y-auto rounded-md border border-[var(--tm-border-2)] bg-[var(--tm-panel)] py-1 text-xs shadow-xl">
            <button
              onClick={save}
              disabled={!hasDesign}
              className="block w-full px-3 py-1.5 text-left text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)] disabled:opacity-40"
            >
              💾 Save “{title}” to browser
            </button>
            <button
              onClick={download}
              disabled={!hasDesign}
              className="block w-full px-3 py-1.5 text-left text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)] disabled:opacity-40"
            >
              ⬇ Download as .json file
            </button>

            <div className="my-1 border-t border-[var(--tm-border)]" />
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
              Recent {projects.length > 0 && `(${projects.length})`}
            </div>

            {projects.length === 0 ? (
              <div className="px-3 py-2 text-[var(--tm-text-faint)]">
                Nothing saved yet. Designs you build here are kept in this browser.
              </div>
            ) : (
              projects.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--tm-btn-hover)]"
                  style={p.id === currentId ? { background: 'var(--tm-chip-active)' } : undefined}
                >
                  <button
                    onClick={() => {
                      onOpen(p.design, p.id);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-[var(--tm-text)]">{p.name}</div>
                    <div className="tabnum text-[10px] text-[var(--tm-text-faint)]">
                      {p.design.nodes.length} nodes · {relativeTime(p.updatedAt)}
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      deleteProject(p.id);
                      setTick((t) => t + 1);
                    }}
                    title="Delete"
                    className="shrink-0 rounded px-1 text-[var(--tm-text-faint)] opacity-0 hover:text-[var(--tm-crit-fg)] group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}

            {projects.length > 0 && (
              <>
                <div className="my-1 border-t border-[var(--tm-border)]" />
                <button
                  onClick={() => {
                    if (confirm('Delete all saved designs from this browser?')) {
                      clearProjects();
                      setTick((t) => t + 1);
                    }
                  }}
                  className="block w-full px-3 py-1.5 text-left text-[var(--tm-text-faint)] hover:bg-[var(--tm-btn-hover)] hover:text-[var(--tm-crit-fg)]"
                >
                  Clear all
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export const ProjectsMenu = memo(ProjectsMenuInner);
