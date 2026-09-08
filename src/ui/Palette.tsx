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

export function Palette() {
  const addNode = useDesignStore((s) => s.addNode);
  const models = allModels();

  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-[var(--tm-border)] bg-[var(--tm-panel)] p-2">
      <div className="mb-2 px-1 text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">Components</div>
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
