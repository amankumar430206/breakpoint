import { memo, useMemo, useState } from 'react';
import type { SystemDesign } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { listProjects, relativeTime } from '@/lib/projectStore';
import { PRESETS } from '@/presets';
import { ProjectPickerModal } from './ProjectPickerModal';

const RECENT_SHOWN = 5;

function EmptyStateInner({
  onLoaded,
  onLoadPreset,
  onRandomize,
  onOpenProject,
}: {
  onLoaded: (title: string) => void;
  onLoadPreset: (id: string) => void;
  onRandomize: () => void;
  onOpenProject: (d: SystemDesign, id: string) => void;
}) {
  const replaceGraph = useDesignStore((s) => s.replaceGraph);
  const addNode = useDesignStore((s) => s.addNode);
  const [picker, setPicker] = useState(false);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => listProjects(), [tick]);
  const recent = all.slice(0, RECENT_SHOWN);

  const blank = () => {
    replaceGraph([], []);
    addNode('client', { x: 300, y: 40 });
    onLoaded('Untitled design');
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="pointer-events-auto w-[440px] max-w-[90%] rounded-xl border border-[var(--tm-border)] bg-[var(--tm-panel)]/95 p-6 text-center shadow-xl">
        <div className="text-lg font-semibold tracking-tight text-[var(--tm-text)]">
          Build a system, watch it take traffic
        </div>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--tm-text-dim)]">
          Drop components from the left, connect them top-to-bottom, then press Play to push
          real traffic through and see where it breaks.
        </p>

        {recent.length > 0 && (
          <div className="mt-5 text-left">
            <div className="mb-1.5 text-center text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
              Recent
            </div>
            <div className="mx-auto flex max-w-[300px] flex-col gap-1">
              {recent.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpenProject(p.design, p.id)}
                  className="flex items-baseline gap-2 rounded border border-[var(--tm-border)] bg-[var(--tm-btn)] px-2.5 py-1.5 text-xs hover:bg-[var(--tm-btn-hover)]"
                >
                  <span className="min-w-0 flex-1 truncate text-left text-[var(--tm-text)]">
                    {p.name}
                  </span>
                  <span className="tabnum shrink-0 text-[10px] text-[var(--tm-text-faint)]">
                    {p.design.nodes.length}n · {relativeTime(p.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
            {all.length > RECENT_SHOWN && (
              <button
                onClick={() => setPicker(true)}
                className="mx-auto mt-1.5 block text-[11px] text-[var(--tm-accent-soft)] hover:underline"
              >
                Show all {all.length} →
              </button>
            )}
          </div>
        )}

        <div className="mt-5">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
            Start from a template
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => onLoadPreset(p.id)}
                className="rounded-lg border border-[var(--tm-accent-border)] bg-[var(--tm-accent-bg)] px-3 py-1.5 text-xs font-medium text-[var(--tm-accent-soft)] hover:bg-[var(--tm-accent-bg-hover)]"
              >
                {p.design.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={blank}
            className="rounded-lg border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-4 py-2 text-sm font-medium text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)]"
          >
            Blank canvas
          </button>
          <button
            onClick={onRandomize}
            className="rounded-lg border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-4 py-2 text-sm font-medium text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)]"
          >
            🎲 Random system
          </button>
        </div>
      </div>

      {picker && (
        <div className="pointer-events-auto">
          <ProjectPickerModal
            onOpen={onOpenProject}
            onClose={() => {
              setPicker(false);
              setTick((t) => t + 1);
            }}
          />
        </div>
      )}
    </div>
  );
}

export const EmptyState = memo(EmptyStateInner);
