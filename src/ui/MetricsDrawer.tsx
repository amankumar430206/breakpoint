import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type uPlot from 'uplot';
import { deriveConcurrency, type ComponentType } from '@/engine';
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
const C_MAX_RHO = '#e5484d';
const C_NODE_CPU = '#3fb950';
const C_NODE_MEM = '#d29922';

const COMPUTE_TYPES = new Set<ComponentType>(['apiServer', 'worker']);

/** How a compute node's ρ maps onto its CPU vs its RAM axis. The binding
 *  resource tracks ρ 1:1; the other sits proportionally lower (it has slack). */
function utilFactors(
  type: ComponentType,
  params: Record<string, unknown>,
): { cpu: number; mem: number | null } | null {
  if (!COMPUTE_TYPES.has(type)) return null;
  const s = deriveConcurrency(params);
  if (!Number.isFinite(s.memSlots)) return { cpu: 1, mem: null };
  return {
    cpu: Math.min(1, s.concurrency / s.cpuSlots),
    mem: Math.min(1, s.concurrency / s.memSlots),
  };
}

const H_KEY = 'tm-drawer-h';
const H_MIN = 140;
const readH = () => {
  try {
    const v = Number(localStorage.getItem(H_KEY));
    return Number.isFinite(v) && v >= H_MIN ? v : 260;
  } catch {
    return 260;
  }
};

function MetricsDrawerInner() {
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

  const trackedNode = nodes.find((n) => n.id === selectedNodeId);
  const trackedLabel = trackedNode?.data.label;
  const factors = useMemo(
    () =>
      trackedNode
        ? utilFactors(trackedNode.type as ComponentType, trackedNode.data.params ?? {})
        : null,
    [trackedNode],
  );

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

  const utilisation: uPlot.AlignedData = useMemo(() => {
    const t = series.map((p) => p.t);
    const rows: (number[] | (number | null)[])[] = [series.map((p) => p.maxRho * 100)];
    if (factors) {
      rows.push(series.map((p) => Math.min(100, p.nodeRho * factors.cpu * 100)));
      rows.push(
        factors.mem == null
          ? series.map(() => null)
          : series.map((p) => Math.min(100, p.nodeRho * (factors.mem as number) * 100)),
      );
    } else if (selectedNodeId) {
      rows.push(series.map((p) => Math.min(100, p.nodeRho * 100)));
    }
    return [t, ...rows];
  }, [series, factors, selectedNodeId]);

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
  const utilSeries: uPlot.Series[] = useMemo(() => {
    const s: uPlot.Series[] = [{}, { label: 'busiest tier ρ', stroke: C_MAX_RHO, width: 1.5 }];
    if (factors) {
      s.push({ label: 'node CPU', stroke: C_NODE_CPU, width: 1.5 });
      if (factors.mem != null) s.push({ label: 'node RAM', stroke: C_NODE_MEM, width: 1.5 });
    } else if (selectedNodeId) {
      s.push({ label: 'node ρ', stroke: C_NODE_CPU, width: 1.5 });
    }
    return s;
  }, [factors, selectedNodeId]);

  const last = series.length ? series[series.length - 1] : null;
  const hasData = series.length > 1;
  const bodyOpen = open || full;

  const utilLegend: [string, string][] = [['busiest tier', C_MAX_RHO]];
  if (factors) {
    utilLegend.push([trackedLabel ? `${trackedLabel} CPU` : 'node CPU', C_NODE_CPU]);
    if (factors.mem != null) utilLegend.push([trackedLabel ? `${trackedLabel} RAM` : 'node RAM', C_NODE_MEM]);
  } else if (selectedNodeId && trackedLabel) {
    utilLegend.push([trackedLabel, C_NODE_CPU]);
  }

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

        <span className="tabnum ml-auto flex flex-wrap justify-end gap-x-4 gap-y-0.5">
          <Kpi label="offered" value={fmtRps(system.offeredRps)} />
          <Kpi label="served" value={fmtRps(system.servedRps)} />
          <Kpi label="p99" value={fmtDuration(system.latency.p99)} />
          <Kpi label="success" value={fmtPct(system.successRate)} alert={system.successRate < 0.97} />
          <Kpi
            label="busiest ρ"
            value={last ? last.maxRho.toFixed(2) : '—'}
            alert={!!last && last.maxRho >= 0.98}
          />
          <Kpi label="in flight" value={last ? last.inFlight.toFixed(0) : '—'} />
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
          className="flex min-h-0 flex-col overflow-y-auto px-4 pb-3"
          style={full ? { flex: '1 1 auto' } : { height: h }}
        >
          {hasData ? (
            <div className="flex min-h-0 w-full flex-col gap-4">
              <div className="grid w-full grid-cols-2 gap-4">
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
              <Panel
                title="Utilisation (%) — CPU / RAM / busiest tier"
                legend={utilLegend}
                hint="Select a compute node on the canvas to see its CPU and RAM separately."
              >
                <UPlotChart
                  data={utilisation}
                  series={utilSeries}
                  height={110}
                  fmtY={(v) => `${Math.round(v)}`}
                />
              </Panel>
            </div>
          ) : (
            <div className="flex w-full flex-1 items-center justify-center text-[11px] text-[var(--tm-text-faint)]">
              {running
                ? 'Recording…'
                : 'Press ▶ Play to record throughput, latency, utilisation and success over the run.'}
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
  hint,
  children,
}: {
  title: string;
  legend: [string, string][];
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-[var(--tm-border)] bg-[var(--tm-panel-2)] p-2">
      <div className="mb-1 flex items-center gap-3 text-[10px] text-[var(--tm-text-faint)]">
        <span className="uppercase tracking-wide" title={hint}>
          {title}
        </span>
        <span className="flex flex-wrap gap-2">
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

function Kpi({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[9px] uppercase text-[var(--tm-text-faint)]">{label}</span>
      <span style={{ color: alert ? 'var(--tm-crit-fg)' : 'var(--tm-text)' }}>{value}</span>
    </span>
  );
}

export const MetricsDrawer = memo(MetricsDrawerInner);
