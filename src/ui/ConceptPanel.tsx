import { lazy, memo, Suspense, useEffect, useState } from 'react';
import { getModel, hasModel, type ComponentType } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { ComponentIcon } from '@/flow/icons';

// Sizeable content chunk — only load it once a node is actually selected.
const ComponentDocView = lazy(() =>
  import('./wiki/DocView').then((m) => ({ default: m.ComponentDocView })),
);

const OPEN_KEY = 'tm-concept-open';
const NARROW = 1180; // below this, the canvas needs the room — default the panel closed

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};

/**
 * A reference pane docked to the left of the Node-details sidebar. When a
 * component is selected it shows that component's System Design Wiki entry —
 * what it is, when to use it, what it pairs with, where people get it wrong —
 * beside the properties you're editing. Collapsible to a thin rail.
 */
function ConceptPanelInner() {
  const nodeId = useDesignStore((s) => s.selectedNodeId);
  const rawType = useDesignStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId)?.type);
  const type: ComponentType | undefined = rawType && hasModel(rawType) ? rawType : undefined;

  const [open, setOpen] = useState(() => readOpen() && window.innerWidth >= NARROW);

  const setOpenPersist = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  // Keep the canvas usable on smaller screens.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < NARROW) setOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Nothing selected, or an edge is selected → no concept to show.
  if (!nodeId || !type) return null;

  const model = getModel(type);

  if (!open) {
    return (
      <aside className="flex w-8 shrink-0 flex-col items-center gap-3 border-l border-[var(--tm-border)] bg-[var(--tm-panel)] py-2">
        <button
          onClick={() => setOpenPersist(true)}
          title="Show the concept reference for this component"
          className="rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-1 py-0.5 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn-hover)]"
        >
          ‹
        </button>
        <span
          className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]"
          style={{ writingMode: 'vertical-rl' }}
        >
          Concept
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-[var(--tm-border)] bg-[var(--tm-panel)]">
      <div className="flex items-center gap-2 border-b border-[var(--tm-border)] px-3 py-1.5 text-[11px]">
        <span className="text-[var(--tm-accent-soft)]">
          <ComponentIcon type={type} size={13} />
        </span>
        <span className="font-medium text-[var(--tm-text)]">{model.label}</span>
        <span className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
          · concept
        </span>
        <a
          href={`../wiki/#component/${type}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-[10px] text-[var(--tm-accent-soft)] hover:underline"
        >
          full page ↗
        </a>
        <a
          href="../wiki/"
          target="_blank"
          rel="noreferrer"
          title="Browse every component and concept"
          className="text-[10px] text-[var(--tm-accent-soft)] hover:underline"
        >
          all docs ↗
        </a>
        <button
          onClick={() => setOpenPersist(false)}
          title="Hide the concept reference"
          className="px-1 text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
        >
          ›
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <Suspense
          fallback={<div className="text-[11px] text-[var(--tm-text-faint)]">Loading…</div>}
        >
          <ComponentDocView key={type} type={type} />
        </Suspense>
      </div>
    </aside>
  );
}

export const ConceptPanel = memo(ConceptPanelInner);
