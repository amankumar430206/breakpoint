import { memo } from 'react';
import { useSimStore } from '@/store/simStore';
import { useDesignStore } from '@/store/designStore';
import type { Fault } from '@/engine';

const LABEL: Record<Fault['kind'], string> = {
  kill: '💀 killed',
  slow: '🐌 slow',
  degrade: '⚠ degraded',
  partition: '✂ cut',
};

/** Floating list of active chaos faults, each removable; hidden when none. */
function ChaosBarInner() {
  const faults = useSimStore((s) => s.faults);
  const removeFault = useSimStore((s) => s.removeFault);
  const clearFaults = useSimStore((s) => s.clearFaults);
  const nodes = useDesignStore((s) => s.nodes);
  const edges = useDesignStore((s) => s.edges);

  if (faults.length === 0) return null;

  const nameOf = (f: Fault): string => {
    if (f.kind === 'partition') {
      const e = edges.find((x) => x.id === f.targetId);
      const src = nodes.find((n) => n.id === e?.source)?.data.label;
      const tgt = nodes.find((n) => n.id === e?.target)?.data.label;
      return src && tgt ? `${src} → ${tgt}` : 'link';
    }
    return nodes.find((n) => n.id === f.targetId)?.data.label ?? f.targetId;
  };

  return (
    <div className="pointer-events-auto w-[240px] rounded-xl border border-[var(--tm-crit-border)] bg-[var(--tm-panel)]/95 shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--tm-crit-fg)]">
        <span>⚡ Chaos active</span>
        <button
          onClick={clearFaults}
          className="ml-auto text-[10px] text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
        >
          restore all
        </button>
      </div>
      <div className="flex flex-col gap-1 px-3 pb-3">
        {faults.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-2 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1 text-[11px]"
          >
            <span className="shrink-0 text-[var(--tm-text-faint)]">{LABEL[f.kind]}</span>
            <span className="flex-1 truncate text-[var(--tm-text)]">{nameOf(f)}</span>
            <button
              onClick={() => removeFault(f.id)}
              className="shrink-0 text-[var(--tm-text-faint)] hover:text-[var(--tm-crit-fg)]"
              title="restore"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ChaosBar = memo(ChaosBarInner);
