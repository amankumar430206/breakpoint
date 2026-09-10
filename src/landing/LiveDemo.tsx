import { useEffect, useMemo, useRef, useState } from 'react';
import type uPlot from 'uplot';
import { fmtDuration, fmtPct, fmtRps } from '@/lib/format';
import { designToHash } from '@/lib/shareUrl';
import { UPlotChart } from '@/ui/UPlotChart';
import { MiniCanvas } from './MiniCanvas';
import { DEMO_DESIGN } from './demoDesign';
import { useEngineLoop } from './useEngineLoop';

const C_FAINT = '#8a8574';
const C_INK = '#17160f';

const SANDBOX_URL = `${import.meta.env.BASE_URL}sandbox/${designToHash(DEMO_DESIGN)}`;

export function LiveDemo() {
  const hostRef = useRef<HTMLDivElement>(null);
  // Start running; the observer only *pauses* it once the figure is confirmed
  // well off-screen (so a flaky/absent IO callback can't leave it frozen).
  const [active, setActive] = useState(true);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const { frame, series } = useEngineLoop(DEMO_DESIGN, active);

  const tputData = useMemo<uPlot.AlignedData>(
    () => [
      series.map((p) => p.t),
      series.map((p) => p.offered),
      series.map((p) => p.served),
    ],
    [series],
  );
  const latData = useMemo<uPlot.AlignedData>(
    () => [series.map((p) => p.t), series.map((p) => p.p99ms)],
    [series],
  );

  const tputSeries = useMemo<uPlot.Series[]>(
    () => [
      {},
      { label: 'offered', stroke: C_FAINT, width: 1, dash: [3, 3] },
      { label: 'served', stroke: C_INK, width: 1.5, fill: 'rgba(23,22,15,0.06)' },
    ],
    [],
  );
  const latSeries = useMemo<uPlot.Series[]>(
    () => [{}, { label: 'p99', stroke: C_INK, width: 1.5, fill: 'rgba(23,22,15,0.05)' }],
    [],
  );

  const dropping = frame.success < 0.995;

  return (
    <figure ref={hostRef} className="lp-appframe" style={{ margin: 0 }}>
      <div className="lp-appbar">
        <span className="lp-appbar-title">breakpoint · read-heavy web tier</span>
        <span className="lp-appbar-status">{frame.phase}</span>
      </div>

      <div className="lp-demo-body">
        <div className="lp-demo-canvas">
          <MiniCanvas design={DEMO_DESIGN} rho={frame.rho} over={frame.over} flow />
        </div>

        <div className="lp-demo-strip">
          <span className="lp-kpi">
            offered <b>{fmtRps(frame.offered)}</b>
          </span>
          <span className="lp-kpi">
            served <b>{fmtRps(frame.served)}</b>
          </span>
          <span className="lp-kpi">
            p99 <b>{fmtDuration(frame.p99ms / 1000)}</b>
          </span>
          <span className="lp-kpi">
            success{' '}
            <b style={{ textDecoration: dropping ? 'underline' : undefined }}>
              {fmtPct(frame.success)}
            </b>
          </span>
        </div>

        <div className="lp-demo-charts">
          <div className="lp-chart-card">
            <div className="lp-chart-title">
              <span>Throughput (req/s)</span>
              <span className="lp-legend" data-dash style={{ ['--_c' as string]: C_FAINT }}>
                offered
              </span>
              <span className="lp-legend" style={{ ['--_c' as string]: C_INK }}>
                served
              </span>
            </div>
            <UPlotChart data={tputData} series={tputSeries} height={124} fmtY={(v) => fmtRps(v)} />
          </div>
          <div className="lp-chart-card">
            <div className="lp-chart-title">
              <span>Latency p99 (ms)</span>
              <span className="lp-legend" style={{ ['--_c' as string]: C_INK }}>
                p99
              </span>
            </div>
            <UPlotChart
              data={latData}
              series={latSeries}
              height={124}
              fmtY={(v) => `${Math.round(v)}`}
            />
          </div>
        </div>
      </div>

      <figcaption className="lp-figcaption">
        <span>
          <b>Figure 1.</b> Analytical solver output, re-solved ~8×/second as a scripted load curve
          walks calm → busy → spike → recovery. Not a recording.
        </span>
        <a className="lp-btn lp-btn-primary lp-btn-sm" href={SANDBOX_URL}>
          Open this in the canvas →
        </a>
      </figcaption>
    </figure>
  );
}
