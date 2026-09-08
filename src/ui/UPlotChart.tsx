import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useThemeStore } from '@/store/themeStore';

export interface UPlotChartProps {
  /** [xValues, ...seriesValues] */
  data: uPlot.AlignedData;
  series: uPlot.Series[];
  /** Initial / fallback height. The chart otherwise fills its container, so a
   *  resizable parent just works (ResizeObserver → setSize, no recreation). */
  height: number;
  /** Optional y-axis value formatter. */
  fmtY?: (v: number) => string;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function UPlotChart({ data, series, height, fmtY }: UPlotChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const theme = useThemeStore((s) => s.theme);

  // (Re)create the chart when structure or theme changes. Size is handled live
  // by the ResizeObserver below, so height changes never recreate.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const axisStroke = cssVar('--tm-text-faint');
    const gridStroke = cssVar('--tm-border');

    const opts: uPlot.Options = {
      width: host.clientWidth || 600,
      height: host.clientHeight || height,
      padding: [6, 10, 0, 0],
      legend: { show: false },
      cursor: { show: true, y: false, points: { show: false } },
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
          size: 44,
          values: fmtY ? (_u, vals) => vals.map((v) => fmtY(v)) : undefined,
          font: '10px ui-monospace, monospace',
        },
      ],
      series,
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

  return <div ref={hostRef} style={{ width: '100%', height: '100%', minHeight: 60 }} />;
}
