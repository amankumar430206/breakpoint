import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useThemeStore } from '@/store/themeStore';

export interface UPlotChartProps {
  /** [xValues, ...seriesValues] */
  data: uPlot.AlignedData;
  series: uPlot.Series[];
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

  // (Re)create the chart when structure or theme changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const axisStroke = cssVar('--tm-text-faint');
    const gridStroke = cssVar('--tm-border');

    const opts: uPlot.Options = {
      width: host.clientWidth || 600,
      height,
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
      if (host.clientWidth) chart.setSize({ width: host.clientWidth, height });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, theme, series.length]);

  // Push new data without recreating.
  useEffect(() => {
    chartRef.current?.setData(data);
  }, [data]);

  return <div ref={hostRef} style={{ width: '100%' }} />;
}
