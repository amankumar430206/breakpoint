import { memo, useState } from 'react';
import { useDesignStore } from '@/store/designStore';
import { useViewStore } from '@/store/viewStore';
import { HEALTH_COLOR } from '@/lib/format';

/** Floating audit card: what's blocking the system and the cheapest fixes.
 *  Fixes apply straight to the design store — one click and the graph re-solves. */
function BottleneckPanelInner() {
  const analysis = useViewStore((s) => s.analysis);
  const updateNodeParams = useDesignStore((s) => s.updateNodeParams);
  const [collapsed, setCollapsed] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  if (!analysis || analysis.healthy) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 w-[340px] rounded-xl border border-[var(--tm-warn-bg)] bg-[var(--tm-panel)]/95 shadow-xl">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[var(--tm-warn-fg)]"
      >
        <span>▲ Bottleneck audit</span>
        <span className="ml-auto text-[var(--tm-text-faint)]">{collapsed ? 'show' : 'hide'}</span>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          <p className="text-[11px] leading-snug text-[var(--tm-text-dim)]">{analysis.summary}</p>

          {analysis.bottlenecks.length > 0 && (
            <div className="flex flex-col gap-1">
              {analysis.bottlenecks.slice(0, 3).map((b) => (
                <div key={b.nodeId} className="flex items-baseline gap-2 text-[11px]">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background: b.severity === 'critical' ? HEALTH_COLOR.crit : HEALTH_COLOR.warn,
                    }}
                  />
                  <span className="text-[var(--tm-text)]">{b.label}</span>
                  <span className="text-[var(--tm-text-faint)]">{b.reason}</span>
                </div>
              ))}
            </div>
          )}

          {analysis.fixes.length > 0 && (
            <div className="mt-1 flex flex-col gap-1.5">
              <div className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
                suggested fixes
              </div>
              {analysis.fixes.map((f, i) => (
                <button
                  key={i}
                  onClick={() => {
                    updateNodeParams(f.nodeId, f.patch);
                    setApplied(f.label);
                  }}
                  className="flex items-center gap-2 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1.5 text-left text-[11px] hover:border-[var(--tm-border-2)] hover:bg-[var(--tm-btn)]"
                >
                  <span
                    className="shrink-0 rounded px-1 text-[10px]"
                    style={{
                      background: f.clears ? 'var(--tm-good-bg)' : 'var(--tm-warn-bg)',
                      color: f.clears ? 'var(--tm-good-fg)' : 'var(--tm-warn-fg)',
                    }}
                  >
                    {f.clears ? 'clears' : 'helps'}
                  </span>
                  <span className="flex-1 text-[var(--tm-text)]">{f.label}</span>
                  <span className="tabnum shrink-0 text-[var(--tm-text-faint)]">
                    {(f.projectedSuccess * 100).toFixed(0)}%
                  </span>
                </button>
              ))}
            </div>
          )}

          {applied && (
            <p className="text-[10px] text-[var(--tm-good-fg)]">Applied: {applied} — re-solving…</p>
          )}
        </div>
      )}
    </div>
  );
}

export const BottleneckPanel = memo(BottleneckPanelInner);
