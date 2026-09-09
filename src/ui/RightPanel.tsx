import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { MonitorPanel } from './MonitorPanel';
import { Inspector } from './Inspector';

type Tab = 'monitor' | 'node';

const OPEN_KEY = 'tm-right-open';
const W_KEY = 'tm-right-w';
const W_MIN = 300;
const W_DEFAULT = 340;
const maxW = () => Math.max(W_MIN, Math.round(window.innerWidth * 0.6));

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};
const readW = () => {
  try {
    const v = Number(localStorage.getItem(W_KEY));
    return Number.isFinite(v) && v >= W_MIN ? Math.min(v, maxW()) : W_DEFAULT;
  } catch {
    return W_DEFAULT;
  }
};

/** Right sidebar: a tabbed dock for live monitoring and the node/edge inspector.
 *  Pressing Play jumps to Monitor; selecting something on the canvas jumps to
 *  Node details. Collapsible to a thin rail to give the canvas the space back. */
function RightPanelInner() {
  const [open, setOpen] = useState(readOpen);
  const [tab, setTab] = useState<Tab>('monitor');
  const [width, setWidth] = useState(readW);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const running = useSimStore((s) => s.running);
  const selected = useDesignStore((s) => s.selectedNodeId ?? s.selectedEdgeId);
  const wasRunning = useRef(running);

  const setOpenPersist = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const onDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // dragging the handle left widens the panel
    setWidth(Math.min(maxW(), Math.max(W_MIN, d.startW + (d.startX - e.clientX))));
  }, []);
  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    document.body.style.cursor = '';
  }, [onDragMove]);
  const startDrag = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  };
  // persist after the width settles
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(W_KEY, String(width));
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [width]);
  // keep within bounds if the window shrinks
  useEffect(() => {
    const onResize = () => setWidth((w) => Math.min(w, maxW()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Play → Monitor.
  useEffect(() => {
    if (running && !wasRunning.current) {
      setTab('monitor');
      setOpen(true);
    }
    wasRunning.current = running;
  }, [running]);

  // Select a component / connection → Node details.
  useEffect(() => {
    if (selected) {
      setTab('node');
      setOpen(true);
    }
  }, [selected]);

  if (!open) {
    return (
      <aside className="flex w-8 shrink-0 flex-col items-center gap-3 border-l border-[var(--tm-border)] bg-[var(--tm-panel)] py-2">
        <button
          onClick={() => setOpenPersist(true)}
          title="Show monitor / inspector"
          className="rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-1 py-0.5 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn-hover)]"
        >
          ‹
        </button>
        <span
          className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]"
          style={{ writingMode: 'vertical-rl' }}
        >
          Monitor
        </span>
      </aside>
    );
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-[var(--tm-border)] bg-[var(--tm-panel)]"
      style={{ width }}
    >
      {/* drag handle on the left edge — widen / narrow the panel */}
      <div
        onPointerDown={startDrag}
        onDoubleClick={() => setWidth(W_DEFAULT)}
        title="Drag to resize · double-click to reset"
        className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-ew-resize"
      >
        <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-[var(--tm-accent)]" />
      </div>
      <div className="flex items-stretch border-b border-[var(--tm-border)] text-[11px]">
        <TabBtn active={tab === 'monitor'} onClick={() => setTab('monitor')}>
          Monitor
        </TabBtn>
        <TabBtn active={tab === 'node'} onClick={() => setTab('node')}>
          Node details
        </TabBtn>
        <button
          onClick={() => setOpenPersist(false)}
          title="Hide panel"
          className="ml-auto px-2 text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
        >
          ›
        </button>
      </div>

      {/* Both mount always so the monitor keeps recording while you're on the
          Node details tab; just hide the inactive one. */}
      <div className="flex min-h-0 flex-1 flex-col" hidden={tab !== 'monitor'}>
        <MonitorPanel />
      </div>
      <div className="flex min-h-0 flex-1 flex-col" hidden={tab !== 'node'}>
        <Inspector />
      </div>
    </aside>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 font-medium"
      style={{
        color: active ? 'var(--tm-text)' : 'var(--tm-text-faint)',
        borderBottom: active ? '2px solid var(--tm-accent)' : '2px solid transparent',
      }}
    >
      {children}
    </button>
  );
}

export const RightPanel = memo(RightPanelInner);
