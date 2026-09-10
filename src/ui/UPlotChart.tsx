import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useThemeStore } from '@/store/themeStore';

export interface UPlotChartProps {
  /** [xValues, ...seriesValues] */
  data: uPlot.AlignedData;
  series: uPlot.Series[];
  /** Chart height in px. Width still fills the container (ResizeObserver →
   *  setSize, no recreation), so a horizontally-resizable parent just works. */
  height: number;
  /** Optional y-axis value formatter — also used in the hover tooltip. */
  fmtY?: (v: number) => string;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function strokeOf(s: uPlot.Series): string {
  return typeof s.stroke === 'string' ? s.stroke : cssVar('--tm-text-dim');
}

export function UPlotChart({ data, series, height, fmtY }: UPlotChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const theme = useThemeStore((s) => s.theme);

  // Keep the latest formatter available to the (long-lived) cursor plugin.
  const fmtRef = useRef(fmtY);
  fmtRef.current = fmtY;

  // (Re)create the chart when structure or theme changes. Size is handled live
  // by the ResizeObserver below, so height changes never recreate.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const axisStroke = cssVar('--tm-text-faint');
    const gridStroke = cssVar('--tm-border');

    // A floating readout of every series' value at the hovered sample.
    const tooltipPlugin: uPlot.Plugin = {
      hooks: {
        setCursor: (u) => {
          const tip = tipRef.current;
          if (!tip) return;
          const { idx, left } = u.cursor;
          if (idx == null || left == null || left < 0) {
            tip.style.display = 'none';
            return;
          }
          const fmt = fmtRef.current ?? ((v: number) => String(Math.round(v)));
          const x = u.data[0][idx];
          let rows = `<div style="color:var(--tm-text-faint);margin-bottom:2px">t = ${Math.round(
            Number(x),
          )}s</div>`;
          for (let i = 1; i < u.series.length; i++) {
            const s = u.series[i];
            if (s.show === false) continue;
            const v = u.data[i]?.[idx];
            if (v == null || Number.isNaN(v)) continue;
            rows +=
              `<div style="display:flex;gap:6px;align-items:center;white-space:nowrap">` +
              `<span style="width:7px;height:7px;border-radius:9px;background:${strokeOf(s)};flex:0 0 auto"></span>` +
              `<span style="color:var(--tm-text-dim)">${s.label ?? ''}</span>` +
              `<span style="margin-left:auto;color:var(--tm-text);font-variant-numeric:tabular-nums">${fmt(Number(v))}</span>` +
              `</div>`;
          }
          tip.innerHTML = rows;
          tip.style.display = 'block';
          // `left` is relative to the plot area (`.u-over`), which itself sits
          // `offsetLeft` px in from our wrapper (past the y-axis). Flip the
          // tooltip to the cursor's left once it would overflow the right edge.
          const ox = (u.over as HTMLElement).offsetLeft;
          const pad = 12;
          const tw = tip.offsetWidth;
          const overRight = left + pad + tw > u.over.clientWidth;
          tip.style.left = `${ox + (overRight ? left - pad - tw : left + pad)}px`;
          tip.style.top = `6px`;
        },
      },
    };

    const opts: uPlot.Options = {
      width: host.clientWidth || 600,
      height: host.clientHeight || height,
      padding: [6, 10, 0, 0],
      legend: { show: false },
      cursor: {
        show: true,
        y: false,
        points: { show: true, size: 6, width: 2, stroke: axisStroke },
      },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          size: 26,
          values: (_u, vals) => vals.map((v) => `${Math.round(v)}s`),
          font: '10px ui-monospace, monospace',
        },
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          size: 52,
          values: fmtY ? (_u, vals) => vals.map((v) => fmtY(v)) : undefined,
          font: '10px ui-monospace, monospace',
        },
      ],
      series,
      plugins: [tooltipPlugin],
    };

    const chart = new uPlot(opts, data, host);
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight || height;
      if (w) chart.setSize({ width: w, height: h });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, series.length]);

  // Push new data without recreating.
  useEffect(() => {
    chartRef.current?.setData(data);
  }, [data]);

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      <div
        ref={tipRef}
        style={{
          position: 'absolute',
          display: 'none',
          pointerEvents: 'none',
          zIndex: 10,
          minWidth: 120,
          padding: '5px 7px',
          borderRadius: 6,
          fontSize: 10,
          lineHeight: 1.5,
          background: 'var(--tm-node)',
          border: '1px solid var(--tm-border-2)',
          boxShadow: '0 2px 8px var(--tm-shadow)',
        }}
      />
    </div>
  );
}
