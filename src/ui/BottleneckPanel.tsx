import { memo, useState, type ReactNode } from 'react';
import { useDesignStore } from '@/store/designStore';
import { useViewStore } from '@/store/viewStore';
import { HEALTH_COLOR } from '@/lib/format';
import type { Advice } from '@/engine';

const DOCS_BASE = 'https://github.com/amankumar430206/breakpoint/blob/main/';

const SEV_COLOR: Record<Advice['severity'], string> = {
  warn: 'var(--tm-warn-fg)',
  note: 'var(--tm-accent)',
  info: 'var(--tm-text-faint)',
};

/** Floating audit card. Two views:
 *  - "Bottlenecks": what's blocking the system + the cheapest one-click fixes.
 *  - "Design review": the qualitative advisor (CAP, replication, caching, …).
 *  Fixes apply straight to the design store — one click and the graph re-solves. */
function BottleneckPanelInner() {
  const analysis = useViewStore((s) => s.analysis);
  const updateNodeParams = useDesignStore((s) => s.updateNodeParams);
  const [applied, setApplied] = useState<string | null>(null);

  const hasBottlenecks =
    !!analysis && !analysis.healthy && (analysis.bottlenecks.length > 0 || analysis.fixes.length > 0);
  const advice = analysis?.advice ?? [];
  const hasAdvice = advice.length > 0;

  const [tab, setTab] = useState<'bottlenecks' | 'review'>('bottlenecks');
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  if (!analysis || (!hasBottlenecks && !hasAdvice)) return null;

  const activeTab = tab === 'bottlenecks' && !hasBottlenecks ? 'review' : tab;
  const anyWarn = advice.some((a) => a.severity === 'warn');
  const isCollapsed = collapsed ?? !(hasBottlenecks || anyWarn);
  const accent = hasBottlenecks ? 'var(--tm-warn-fg)' : 'var(--tm-text-dim)';

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 w-[340px] rounded-xl border border-[var(--tm-border)] bg-[var(--tm-panel)]/95 shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium">
        {hasBottlenecks && hasAdvice ? (
          <div className="flex gap-1">
            <TabBtn active={activeTab === 'bottlenecks'} onClick={() => setTab('bottlenecks')}>
              Bottlenecks
            </TabBtn>
            <TabBtn active={activeTab === 'review'} onClick={() => setTab('review')}>
              Design review
            </TabBtn>
          </div>
        ) : (
          <span style={{ color: accent }}>
            {hasBottlenecks ? '▲ Bottleneck audit' : 'Design review'}
          </span>
        )}
        <button
          onClick={() => setCollapsed(!isCollapsed)}
          className="ml-auto text-[var(--tm-text-faint)]"
        >
          {isCollapsed ? 'show' : 'hide'}
        </button>
      </div>

      {!isCollapsed && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {activeTab === 'bottlenecks' && hasBottlenecks && (
            <>
              <p className="text-[11px] leading-snug text-[var(--tm-text-dim)]">{analysis.summary}</p>

              {analysis.bottlenecks.length > 0 && (
                <div className="flex flex-col gap-1">
                  {analysis.bottlenecks.slice(0, 3).map((b) => (
                    <div key={b.nodeId} className="flex items-baseline gap-2 text-[11px]">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background:
                            b.severity === 'critical' ? HEALTH_COLOR.crit : HEALTH_COLOR.warn,
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
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1.5 text-[11px]"
                    >
                      <span
                        className="shrink-0 rounded px-1 text-[10px]"
                        style={{
                          background: f.clears ? 'var(--tm-good-bg)' : 'var(--tm-warn-bg)',
                          color: f.clears ? 'var(--tm-good-fg)' : 'var(--tm-warn-fg)',
                        }}
                        title={f.clears ? 'projected to fully clear the bottleneck' : 'projected to help, but not fully clear it'}
                      >
                        {f.clears ? 'clears' : 'helps'}
                      </span>
                      <span className="min-w-0 flex-1 text-[var(--tm-text)]">{f.label}</span>
                      <span
                        className="tabnum shrink-0 text-[var(--tm-text-faint)]"
                        title="projected success rate after this change"
                      >
                        {(f.projectedSuccess * 100).toFixed(0)}%
                      </span>
                      <button
                        onClick={() => {
                          updateNodeParams(f.nodeId, f.patch);
                          setApplied(f.label);
                        }}
                        className="shrink-0 rounded border border-[var(--tm-accent-border)] bg-[var(--tm-accent-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--tm-accent)] hover:bg-[var(--tm-accent-bg-hover)]"
                      >
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {applied && (
                <p className="text-[10px] text-[var(--tm-good-fg)]">
                  Applied: {applied} — re-solving…
                </p>
              )}
            </>
          )}

          {activeTab === 'review' && (
            <div className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto">
              {advice.map((a, i) => (
                <AdviceRow key={i} a={a} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TabBtn = memo(function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-[11px]"
      style={{
        background: active ? 'var(--tm-chip-active)' : 'transparent',
        color: active ? 'var(--tm-text)' : 'var(--tm-text-faint)',
      }}
    >
      {children}
    </button>
  );
});

const AdviceRow = memo(function AdviceRow({ a }: { a: Advice }) {
  return (
    <div className="rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1.5">
      <div className="flex items-baseline gap-1.5">
        <span
          className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
          style={{ background: SEV_COLOR[a.severity] }}
        />
        <span className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
          {a.topic}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-[var(--tm-text)]">{a.verdict}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-[var(--tm-text-dim)]">{a.why}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-[var(--tm-text-faint)]">
        <span className="text-[var(--tm-text-dim)]">Use it when: </span>
        {a.useWhen}
      </p>
      <a
        href={`${DOCS_BASE}${a.docHref}`}
        target="_blank"
        rel="noreferrer"
        className="mt-0.5 inline-block text-[10px] text-[var(--tm-accent)] hover:underline"
      >
        concepts →
      </a>
    </div>
  );
});

export const BottleneckPanel = memo(BottleneckPanelInner);
