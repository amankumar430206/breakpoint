import { useEffect, useMemo, useState } from 'react';
import type { SystemDesign } from '@/engine';
import { deleteProject, listProjects, relativeTime } from '@/lib/projectStore';

/** Full searchable list of every browser-saved design, with per-row delete. */
export function ProjectPickerModal({
  onOpen,
  onClose,
}: {
  onOpen: (design: SystemDesign, id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const projects = useMemo(() => listProjects(), [tick]);
  const filtered = q.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
    : projects;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[520px] max-w-full flex-col overflow-hidden rounded-lg border border-[var(--tm-border-2)] bg-[var(--tm-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--tm-border)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--tm-text)]">Open a design</span>
          <span className="text-[11px] text-[var(--tm-text-faint)]">
            {projects.length} saved in this browser
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded px-1.5 text-[var(--tm-text-faint)] hover:bg-[var(--tm-btn)] hover:text-[var(--tm-text)]"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-[var(--tm-border)] p-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search designs…"
            className="w-full rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1.5 text-sm text-[var(--tm-text)] outline-none focus:border-[var(--tm-accent)]"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--tm-text-faint)]">
              {projects.length === 0 ? 'Nothing saved yet.' : 'No designs match your search.'}
            </div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-2 rounded px-3 py-2 hover:bg-[var(--tm-btn-hover)]"
              >
                <button
                  onClick={() => {
                    onOpen(p.design, p.id);
                    onClose();
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm text-[var(--tm-text)]">{p.name}</div>
                  <div className="tabnum text-[11px] text-[var(--tm-text-faint)]">
                    {p.design.nodes.length} nodes · {relativeTime(p.updatedAt)}
                  </div>
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete “${p.name}”?`)) {
                      deleteProject(p.id);
                      setTick((t) => t + 1);
                    }
                  }}
                  title="Delete"
                  className="shrink-0 rounded px-1.5 py-1 text-[var(--tm-text-faint)] opacity-0 hover:text-[var(--tm-crit-fg)] group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
