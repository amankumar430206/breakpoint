import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
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

/** Live monitoring — system KPIs plus throughput / latency / utilisation over
 *  time. Lives in the right sidebar's "Monitor" tab; a fullscreen toggle blows
 *  the charts up into an overlay. */
function MonitorPanelInner() {
  const [full, setFull] = useState(false);

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

  useEffect(() => {
    setSeriesNode(selectedNodeId);
  }, [selectedNodeId, setSeriesNode]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

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

  const utilLegend: [string, string][] = [['busiest tier', C_MAX_RHO]];
  if (factors) {
    utilLegend.push([trackedLabel ? `${trackedLabel} CPU` : 'node CPU', C_NODE_CPU]);
    if (factors.mem != null)
      utilLegend.push([trackedLabel ? `${trackedLabel} RAM` : 'node RAM', C_NODE_MEM]);
  } else if (selectedNodeId && trackedLabel) {
    utilLegend.push([trackedLabel, C_NODE_CPU]);
  }

  const kpis = (
    <div className="tabnum grid grid-cols-3 gap-x-3 gap-y-1.5 px-3 py-2 text-[11px]">
      <Kpi label="offered" value={fmtRps(system.offeredRps)} />
      <Kpi label="served" value={fmtRps(system.servedRps)} />
      <Kpi
        label="success"
        value={fmtPct(system.successRate)}
        alert={system.successRate < 0.97}
      />
      <Kpi label="p99" value={fmtDuration(system.latency.p99)} />
      <Kpi
        label="busiest ρ"
        value={last ? last.maxRho.toFixed(2) : '—'}
        alert={!!last && last.maxRho >= 0.98}
      />
      <Kpi label="in flight" value={last ? last.inFlight.toFixed(0) : '—'} />
    </div>
  );

  // Taller in the sidebar (the condensed default read poorly); the scroll
  // container absorbs the overflow as more charts are added.
  const chartH = full ? 240 : 190;

  const charts = (
    <>
      <Panel
        title="Throughput (req/s)"
        legend={[
          ['offered', C_OFFERED],
          ['served', C_SERVED],
        ]}
      >
        <UPlotChart data={throughput} series={tputSeries} height={chartH} fmtY={(v) => fmtRps(v)} />
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
        <UPlotChart data={latency} series={latSeries} height={chartH} fmtY={(v) => `${Math.round(v)}`} />
      </Panel>
      <Panel title="Utilisation (%) — CPU / RAM / busiest tier" legend={utilLegend}>
        <UPlotChart
          data={utilisation}
          series={utilSeries}
          height={chartH}
          fmtY={(v) => `${Math.round(v)}`}
        />
      </Panel>
    </>
  );

  const header = (
    <div className="flex items-center gap-2 border-b border-[var(--tm-border)] px-3 py-1.5 text-[11px] text-[var(--tm-text-dim)]">
      <SystemGrade />
      {mode === 'live' && (
        <span className="tabnum text-[var(--tm-text-faint)]">t = {simTime.toFixed(0)}s</span>
      )}
      <button
        onClick={running ? pause : play}
        className="rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-2 py-0.5 text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)]"
      >
        {running ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button
        onClick={reset}
        title="Reset simulation"
        className="rounded border border-[var(--tm-border-2)] px-1.5 py-0.5 hover:bg-[var(--tm-btn)]"
      >
        ⟲
      </button>
      <button
        onClick={() => setFull((f) => !f)}
        title={full ? 'Exit fullscreen (Esc)' : 'Fullscreen charts'}
        className="ml-auto shrink-0 rounded border border-[var(--tm-border-2)] px-1.5 py-0.5 hover:bg-[var(--tm-btn)]"
      >
        {full ? '⤡' : '⤢'}
      </button>
    </div>
  );

  if (full) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-[var(--tm-panel)]">
        {header}
        {kpis}
        {hasData ? (
          <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-4">{charts}</div>
        ) : (
          <Waiting running={running} />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {kpis}
      {hasData ? (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">{charts}</div>
      ) : (
        <Waiting running={running} />
      )}
    </div>
  );
}

function Waiting({ running }: { running: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-[var(--tm-text-faint)]">
      {running
        ? 'Recording…'
        : 'Press ▶ Play to record throughput, latency, utilisation and success over the run.'}
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
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-[var(--tm-border)] bg-[var(--tm-panel-2)] p-2">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[var(--tm-text-faint)]">
        <span className="uppercase tracking-wide">{title}</span>
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

export const MonitorPanel = memo(MonitorPanelInner);
