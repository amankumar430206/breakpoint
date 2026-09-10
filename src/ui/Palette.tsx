import { memo, useState } from 'react';
import { allModels, type ComponentType } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { ComponentIcon } from '@/flow/icons';

const CATEGORY_ORDER = [
  'source',
  'network',
  'compute',
  'messaging',
  'data',
  'external',
  'resilience',
] as const;
const CATEGORY_LABEL: Record<string, string> = {
  source: 'Traffic',
  network: 'Network',
  compute: 'Compute',
  messaging: 'Messaging',
  data: 'Data',
  external: 'Third-party',
  resilience: 'Resilience',
};

const OPEN_KEY = 'tm-palette-open';
const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};

function PaletteInner() {
  const addNode = useDesignStore((s) => s.addNode);
  const models = allModels();
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !o;
    });
  };

  if (!open) {
    return (
      <aside className="flex w-8 shrink-0 flex-col items-center border-r border-[var(--tm-border)] bg-[var(--tm-panel)] py-2">
        <button
          onClick={toggle}
          title="Show components"
          className="rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-1 py-0.5 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn-hover)]"
        >
          ›
        </button>
        <span
          className="mt-3 text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]"
          style={{ writingMode: 'vertical-rl' }}
        >
          Components
        </span>
      </aside>
    );
  }

  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-[var(--tm-border)] bg-[var(--tm-panel)] p-2">
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <span className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">Components</span>
        <a
          href="../wiki/"
          target="_blank"
          rel="noreferrer"
          title="System Design Wiki — what each component is, when to use it"
          className="text-[10px] text-[var(--tm-accent-soft)] no-underline hover:underline"
        >
          learn ↗
        </a>
        <button
          onClick={toggle}
          title="Hide components"
          className="ml-auto rounded px-1 text-xs text-[var(--tm-text-faint)] hover:bg-[var(--tm-btn)] hover:text-[var(--tm-text)]"
        >
          ‹
        </button>
      </div>
      {CATEGORY_ORDER.map((cat) => {
        const items = models.filter((m) => m.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="mb-3">
            <div className="mb-1 px-1 text-[10px] font-medium text-[var(--tm-text-faint)]">
              {CATEGORY_LABEL[cat]}
            </div>
            <div className="flex flex-col gap-1">
              {items.map((m) => (
                <button
                  key={m.type}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/tm-component', m.type);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => addNode(m.type as ComponentType, { x: 120, y: 80 })}
                  className="flex items-center gap-2 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1.5 text-left text-xs text-[var(--tm-text)] hover:border-[var(--tm-border-2)] hover:bg-[var(--tm-btn)]"
                  title={`Add ${m.label} — drag onto the canvas`}
                >
                  <span className="text-[var(--tm-text-faint)]">
                    <ComponentIcon type={m.type as ComponentType} size={16} />
                  </span>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

export const Palette = memo(PaletteInner);
