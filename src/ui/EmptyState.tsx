import { memo, useMemo, useState } from 'react';
import type { ComponentType, SystemDesign } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { deleteProject, listProjects, relativeTime, type SavedProject } from '@/lib/projectStore';
import { PRESETS, PRESET_META, TAG_COLOR, TAG_LABEL } from '@/presets';
import { ComponentIcon } from '@/flow/icons';
import { ProjectPickerModal } from './ProjectPickerModal';

const RECENT_SHOWN = 6;
const SHAPE_MAX = 7;

/** Distinct node types in wiring order — a design's "shape" at a glance. */
function shapeOf(design: SystemDesign): ComponentType[] {
  const seen = new Set<ComponentType>();
  const out: ComponentType[] = [];
  for (const n of design.nodes) {
    if (!seen.has(n.type)) {
      seen.add(n.type);
      out.push(n.type);
    }
  }
  return out;
}

/** Collapse autosave near-duplicates — keep the newest row per name.
 *  `listProjects()` is already newest-first. */
function dedupeByName(list: SavedProject[]): SavedProject[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = p.name.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function Shape({ types }: { types: ComponentType[] }) {
  return (
    <div className="flex items-center gap-1 text-[var(--tm-text-faint)]">
      {types.slice(0, SHAPE_MAX).map((t, i) => (
        <ComponentIcon key={`${t}-${i}`} type={t} size={13} />
      ))}
      {types.length > SHAPE_MAX && (
        <span className="tabnum text-[9px]">+{types.length - SHAPE_MAX}</span>
      )}
    </div>
  );
}

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
  const saved = useMemo(() => listProjects(), [tick]);
  const recent = useMemo(() => dedupeByName(saved).slice(0, RECENT_SHOWN), [saved]);

  const blank = () => {
    replaceGraph([], []);
    addNode('client', { x: 300, y: 40 });
    onLoaded('Untitled design');
  };

  const ghostBtn =
    'flex items-center gap-1.5 rounded-lg border border-[var(--tm-border-2)] px-3 py-1.5 text-[12px] font-medium text-[var(--tm-text-dim)] transition-colors hover:bg-[var(--tm-btn)] hover:text-[var(--tm-text)]';

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-[var(--tm-bg)]">
      <div className="mx-auto max-w-[980px] px-6 py-10">
        {/* header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--tm-text)]">
              Build a system, watch it break
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--tm-text-dim)]">
              Start from a template or a saved design, wire the components top-to-bottom, then press{' '}
              <span className="font-medium text-[var(--tm-text)]">▶ Play</span> to push real traffic
              through and find the breaking point.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={blank} className={ghostBtn}>
              Blank canvas
            </button>
            <button onClick={onRandomize} className={ghostBtn}>
              <DiceIcon />
              Random
            </button>
          </div>
        </div>

        {/* recent */}
        <section className="mt-9">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[10px] font-medium uppercase tracking-wide text-[var(--tm-text-faint)]">
              Recent designs
            </h2>
            {saved.length > recent.length && (
              <button
                onClick={() => setPicker(true)}
                className="text-[11px] text-[var(--tm-accent-soft)] hover:underline"
              >
                All {saved.length} designs →
              </button>
            )}
          </div>
          {recent.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {recent.map((p) => (
                <div
                  key={p.id}
                  className="group relative flex flex-col gap-2 rounded-lg border border-[var(--tm-border)] bg-[var(--tm-node)] p-3 transition-all hover:-translate-y-px hover:border-[var(--tm-border-2)] hover:shadow-md"
                >
                  <button
                    onClick={() => onOpenProject(p.design, p.id)}
                    className="min-w-0 text-left"
                  >
                    <div className="truncate text-[13px] font-medium text-[var(--tm-text)]">
                      {p.name}
                    </div>
                    <div className="tabnum mt-0.5 text-[10px] text-[var(--tm-text-faint)]">
                      {p.design.nodes.length} nodes · {relativeTime(p.updatedAt)}
                    </div>
                  </button>
                  <Shape types={shapeOf(p.design)} />
                  <button
                    onClick={() => {
                      deleteProject(p.id);
                      setTick((t) => t + 1);
                    }}
                    title={`Delete "${p.name}"`}
                    className="absolute right-1.5 top-1.5 rounded px-1 text-[var(--tm-text-faint)] opacity-0 transition-opacity hover:text-[var(--tm-crit-fg)] group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-[var(--tm-text-faint)]">
              No saved designs yet — start from a template below.
            </p>
          )}
        </section>

        {/* templates */}
        <section className="mt-10">
          <h2 className="mb-3 text-[10px] font-medium uppercase tracking-wide text-[var(--tm-text-faint)]">
            Start from a template
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {PRESETS.map(({ id, design }) => {
              const meta = PRESET_META[id] ?? { tag: 'web' as const };
              return (
                <button
                  key={id}
                  onClick={() => onLoadPreset(id)}
                  title={design.description}
                  className="group flex flex-col gap-1.5 rounded-lg border border-[var(--tm-border)] bg-[var(--tm-node)] p-3 text-left transition-all hover:-translate-y-px hover:border-[var(--tm-border-2)] hover:shadow-md"
                  style={{ borderLeft: `3px solid ${TAG_COLOR[meta.tag]}` }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--tm-text)]">
                      {design.name}
                    </span>
                    {meta.recommended && (
                      <span
                        className="shrink-0 rounded px-1 text-[9px] font-semibold uppercase tracking-wide"
                        style={{ background: 'var(--tm-accent-bg)', color: 'var(--tm-accent-soft)' }}
                      >
                        Start here
                      </span>
                    )}
                    <span className="tabnum shrink-0 rounded bg-[var(--tm-chip)] px-1 text-[9px] text-[var(--tm-text-faint)]">
                      {design.nodes.length}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-snug text-[var(--tm-text-dim)]">
                    {design.description}
                  </p>
                  <div className="flex items-center justify-between pt-0.5">
                    <span
                      className="text-[9px] font-medium uppercase tracking-wide"
                      style={{ color: TAG_COLOR[meta.tag] }}
                    >
                      {TAG_LABEL[meta.tag]}
                    </span>
                    <span className="transition-colors group-hover:text-[var(--tm-text-dim)]">
                      <Shape types={shapeOf(design)} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {picker && (
        <ProjectPickerModal
          onOpen={onOpenProject}
          onClose={() => {
            setPicker(false);
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

function DiceIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="14" height="14" rx="3" />
      <circle cx="7" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="13" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export const EmptyState = memo(EmptyStateInner);
