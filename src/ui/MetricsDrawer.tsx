import { useEffect, useMemo, useState } from 'react';
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

export function MetricsDrawer() {
  const [open, setOpen] = useState(true);
  const series = useViewStore((s) => s.series);
  const system = useViewStore((s) => s.system);
  const mode = useViewStore((s) => s.mode);
  const simTime = useViewStore((s) => s.simTime);
  const setSeriesNode = useViewStore((s) => s.setSeriesNode);
  const selectedNodeId = useDesignStore((s) => s.selectedNodeId);
  const nodes = useDesignStore((s) => s.nodes);
  const running = useSimStore((s) => s.running);

  // Track whichever node is selected.
  useEffect(() => {
    setSeriesNode(selectedNodeId);
  }, [selectedNodeId, setSeriesNode]);

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

  return (
    <div className="shrink-0 border-t border-[var(--tm-border)] bg-[var(--tm-panel)]">
      <div className="flex w-full items-center gap-3 px-4 py-1.5 text-[11px] text-[var(--tm-text-dim)]">
        <button
          onClick={() => setOpen((o) => !o)}
          className="font-medium text-[var(--tm-text)]"
        >
          {open ? '▾' : '▸'} Metrics over time
        </button>
        <SystemGrade />
        {mode === 'live' && <span className="tabnum text-[var(--tm-text-faint)]">t = {simTime.toFixed(0)}s</span>}
        <span className="tabnum ml-auto flex gap-4">
          <Kpi label="offered" value={fmtRps(system.offeredRps)} />
          <Kpi label="served" value={fmtRps(system.servedRps)} />
          <Kpi label="p99" value={fmtDuration(system.latency.p99)} />
          <Kpi label="success" value={fmtPct(system.successRate)} />
        </span>
      </div>

      {open && (
        <div className="px-4 pb-3">
          {hasData ? (
            <div className="grid grid-cols-2 gap-4">
              <Panel title="Throughput (req/s)" legend={[['offered', C_OFFERED], ['served', C_SERVED]]}>
                <UPlotChart data={throughput} series={tputSeries} height={120} fmtY={(v) => fmtRps(v)} />
              </Panel>
              <Panel
                title="Latency p99 (ms)"
                legend={
                  selectedNodeId && trackedLabel
                    ? [['system', C_SYS_P99], [trackedLabel, C_NODE_P99]]
                    : [['system', C_SYS_P99]]
                }
              >
                <UPlotChart data={latency} series={latSeries} height={120} fmtY={(v) => `${Math.round(v)}`} />
              </Panel>
            </div>
          ) : (
            <div className="py-6 text-center text-[11px] text-[var(--tm-text-faint)]">
              {running ? 'Recording…' : 'Press ▶ Play to record throughput, latency and success over the run.'}
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
    <div className="rounded-lg border border-[var(--tm-border)] bg-[var(--tm-panel-2)] p-2">
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
      {children}
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
