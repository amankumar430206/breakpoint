import { useDesignStore } from '@/store/designStore';
import { PRESETS } from '@/presets';

export function EmptyState({
  onLoaded,
  onLoadPreset,
  onRandomize,
}: {
  onLoaded: (title: string) => void;
  onLoadPreset: (id: string) => void;
  onRandomize: () => void;
}) {
  const replaceGraph = useDesignStore((s) => s.replaceGraph);
  const addNode = useDesignStore((s) => s.addNode);

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
    </div>
  );
}
