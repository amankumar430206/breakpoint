import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type uPlot from 'uplot';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { useViewStore } from '@/store/viewStore';
import { fmtDuration, fmtPct, fmtRps } from '@/lib/format';
import { UPlotChart } from './UPlotChart';
import { SystemGrade } from './SystemGrade';

const C_OFFERED = '#7d8796';
const C_SERVED = '#3b82f6';
const C_SYS_P99 = '#f0883e';
const C_NODE_P99 = '#8b5cf6';

const H_KEY = 'tm-drawer-h';
const H_MIN = 140;
const readH = () => {
  try {
    const v = Number(localStorage.getItem(H_KEY));
    return Number.isFinite(v) && v >= H_MIN ? v : 240;
  } catch {
    return 240;
  }
};

export function MetricsDrawer() {
  const [open, setOpen] = useState(true);
  const [full, setFull] = useState(false);
  const [h, setH] = useState(readH);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const series = useViewStore((s) => s.series);
  const system = useViewStore((s) => s.system);
  const mode = useViewStore((s) => s.mode);
  const simTime = useViewStore((s) => s.simTime);
  const setSeriesNode = useViewStore((s) => s.setSeriesNode);
  const selectedNodeId = useDesignStore((s) => s.selectedNodeId);
  const nodes = useDesignStore((s) => s.nodes);
  const running = useSimStore((s) => s.running);
  const play = useSimStore((s) => s.play);
  const pause = useSimStore((s) => s.pause);
  const reset = useSimStore((s) => s.reset);

  // Track whichever node is selected.
  useEffect(() => {
    setSeriesNode(selectedNodeId);
  }, [selectedNodeId, setSeriesNode]);

  // Esc leaves fullscreen.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const onDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const max = Math.round(window.innerHeight * 0.85);
    const next = Math.min(max, Math.max(H_MIN, d.startH + (d.startY - e.clientY)));
    setH(next);
  }, []);
  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
  }, [onDragMove]);
  const startDrag = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, startH: h };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  };
  // persist after h settles
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(H_KEY, String(h));
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [h]);

  const trackedLabel = nodes.find((n) => n.id === selectedNodeId)?.data.label;

  const throughput: uPlot.AlignedData = useMemo(() => {
    const t = series.map((p) => p.t);
    return [t, series.map((p) => p.offeredRps), series.map((p) => p.servedRps)];
  }, [series]);

  const latency: uPlot.AlignedData = useMemo(() => {
    const t = series.map((p) => p.t);
    return [
      t,
      series.map((p) => p.p99 * 1000),
      selectedNodeId ? series.map((p) => p.nodeP99 * 1000) : [],
    ];
  }, [series, selectedNodeId]);

  const tputSeries: uPlot.Series[] = useMemo(
    () => [
      {},
      { label: 'offered', stroke: C_OFFERED, width: 1.5 },
      { label: 'served', stroke: C_SERVED, width: 1.5, fill: 'rgba(59,130,246,0.10)' },
    ],
    [],
  );
  const latSeries: uPlot.Series[] = useMemo(
    () => [
      {},
      { label: 'system p99', stroke: C_SYS_P99, width: 1.5 },
      ...(selectedNodeId ? [{ label: 'node p99', stroke: C_NODE_P99, width: 1.5 }] : []),
    ],
    [selectedNodeId],
  );

  const hasData = series.length > 1;
  const bodyOpen = open || full;

  return (
    <div
      className={
        full
          ? 'fixed inset-0 z-40 flex flex-col bg-[var(--tm-panel)]'
          : 'relative flex shrink-0 flex-col border-t border-[var(--tm-border)] bg-[var(--tm-panel)]'
      }
    >
      {open && !full && (
        <div
          onPointerDown={startDrag}
          title="Drag to resize"
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-ns-resize"
        >
          <div className="mx-auto mt-[3px] h-1 w-10 rounded-full bg-[var(--tm-border-2)]" />
        </div>
      )}

      <div className="flex w-full items-center gap-3 px-4 py-1.5 text-[11px] text-[var(--tm-text-dim)]">
        <button
          onClick={() => (full ? setFull(false) : setOpen((o) => !o))}
          className="font-medium text-[var(--tm-text)]"
        >
          {bodyOpen ? '▾' : '▸'} Metrics over time
        </button>
        <SystemGrade />
        {mode === 'live' && (
          <span className="tabnum text-[var(--tm-text-faint)]">t = {simTime.toFixed(0)}s</span>
        )}

        {full && (
          <span className="flex items-center gap-1.5">
            <button
              onClick={running ? pause : play}
              className="rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-2 py-0.5 text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)]"
            >
              {running ? '❚❚ Pause' : '▶ Play'}
            </button>
            <button
              onClick={reset}
              className="rounded border border-[var(--tm-border-2)] px-2 py-0.5 hover:bg-[var(--tm-btn)]"
            >
              ⟲
            </button>
          </span>
        )}

        <span className="tabnum ml-auto flex gap-4">
          <Kpi label="offered" value={fmtRps(system.offeredRps)} />
          <Kpi label="served" value={fmtRps(system.servedRps)} />
          <Kpi label="p99" value={fmtDuration(system.latency.p99)} />
          <Kpi label="success" value={fmtPct(system.successRate)} />
        </span>

        <button
          onClick={() => {
            setFull((f) => !f);
            setOpen(true);
          }}
          title={full ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          className="shrink-0 rounded border border-[var(--tm-border-2)] px-1.5 py-0.5 hover:bg-[var(--tm-btn)]"
        >
          {full ? '⤡' : '⤢'}
        </button>
      </div>

      {bodyOpen && (
        <div
          className="flex min-h-0 px-4 pb-3"
          style={full ? { flex: '1 1 auto' } : { height: h }}
        >
          {hasData ? (
            <div className="grid min-h-0 w-full grid-cols-2 gap-4">
              <Panel
                title="Throughput (req/s)"
                legend={[
                  ['offered', C_OFFERED],
                  ['served', C_SERVED],
                ]}
              >
                <UPlotChart data={throughput} series={tputSeries} height={120} fmtY={(v) => fmtRps(v)} />
              </Panel>
              <Panel
                title="Latency p99 (ms)"
                legend={
                  selectedNodeId && trackedLabel
                    ? [
                        ['system', C_SYS_P99],
                        [trackedLabel, C_NODE_P99],
                      ]
                    : [['system', C_SYS_P99]]
                }
              >
                <UPlotChart
                  data={latency}
                  series={latSeries}
                  height={120}
                  fmtY={(v) => `${Math.round(v)}`}
                />
              </Panel>
            </div>
          ) : (
            <div className="flex w-full items-center justify-center text-[11px] text-[var(--tm-text-faint)]">
              {running
                ? 'Recording…'
                : 'Press ▶ Play to record throughput, latency and success over the run.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  legend,
  children,
}: {
  title: string;
  legend: [string, string][];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-[var(--tm-border)] bg-[var(--tm-panel-2)] p-2">
      <div className="mb-1 flex items-center gap-3 text-[10px] text-[var(--tm-text-faint)]">
        <span className="uppercase tracking-wide">{title}</span>
        <span className="flex gap-2">
          {legend.map(([l, c]) => (
            <span key={l} className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />
              {l}
            </span>
          ))}
        </span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[9px] uppercase text-[var(--tm-text-faint)]">{label}</span>
      <span className="text-[var(--tm-text)]">{value}</span>
    </span>
  );
}
