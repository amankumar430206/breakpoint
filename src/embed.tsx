/* eslint-disable react-refresh/only-export-components -- entry file, never HMR'd */
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import './index.css';
import type { SystemDesign } from '@/engine';
import { Canvas } from '@/flow/Canvas';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { useSimWorker } from '@/store/simWorker';
import { useViewStore } from '@/store/viewStore';
import { fromDesign } from '@/lib/design';
import { designFromHash, designToHash } from '@/lib/shareUrl';
import { getPreset } from '@/presets';
import { fmtDuration, fmtPct, fmtRps } from '@/lib/format';
import { applyTheme } from '@/lib/theme';

/**
 * Read-only embeddable widget. `?d=<lz-string>` or `?preset=<id>` supply the
 * design; `?theme=light|dark` is optional. Renders a locked canvas + a compact
 * metrics strip and auto-plays the design's scenario.
 */

const params = new URLSearchParams(location.search);

const themeParam = params.get('theme');
applyTheme(
  themeParam === 'light' || themeParam === 'dark'
    ? themeParam
    : window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark',
);

function readDesign(): SystemDesign | null {
  const d = params.get('d');
  if (d) return designFromHash(`#d=${d}`);
  const preset = params.get('preset');
  if (preset) return getPreset(preset) ?? null;
  return null;
}

const SANDBOX = location.pathname.replace(/embed(\.html)?\/?$/, 'sandbox/');

function MetricsStrip({ openHref }: { openHref: string }) {
  const system = useViewStore((s) => s.system);
  const grade = useViewStore((s) => s.analysis?.capacity.grade);
  return (
    <div className="tabnum flex items-center gap-4 border-t border-[var(--tm-border)] bg-[var(--tm-panel)] px-3 py-1.5 text-[11px] text-[var(--tm-text-dim)]">
      <span>
        <b className="text-[var(--tm-text)]">{fmtRps(system.offeredRps)}</b> offered
      </span>
      <span>
        <b className="text-[var(--tm-text)]">{fmtRps(system.servedRps)}</b> served
      </span>
      <span>
        <b className="text-[var(--tm-text)]">{fmtDuration(system.latency.p99)}</b> p99
      </span>
      <span>
        <b style={{ color: system.successRate < 0.99 ? 'var(--tm-crit-fg)' : 'var(--tm-text)' }}>
          {fmtPct(system.successRate)}
        </b>{' '}
        ok
      </span>
      {grade && grade !== '—' && (
        <span className="rounded bg-[var(--tm-chip)] px-1.5 py-0.5">grade {grade}</span>
      )}
      <a
        href={openHref}
        target="_blank"
        rel="noreferrer"
        className="ml-auto shrink-0 text-[var(--tm-accent-soft)] hover:underline"
      >
        open in Breakpoint →
      </a>
    </div>
  );
}

function Embed({ design }: { design: SystemDesign }) {
  const replaceGraph = useDesignStore((s) => s.replaceGraph);
  const loadSim = useSimStore((s) => s.loadSim);
  const play = useSimStore((s) => s.play);
  useSimWorker();

  useEffect(() => {
    const { nodes, edges } = fromDesign(design);
    replaceGraph(nodes, edges);
    loadSim(design.sim);
    const t = setTimeout(() => play(), 500); // let the first analytical solve land
    return () => clearTimeout(t);
  }, [design, replaceGraph, loadSim, play]);

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col overflow-hidden bg-[var(--tm-bg)]">
        <div className="relative min-h-0 flex-1">
          <Canvas readOnly />
        </div>
        <MetricsStrip openHref={`${SANDBOX}${designToHash(design)}`} />
      </div>
    </ReactFlowProvider>
  );
}

function Missing() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-[var(--tm-bg)] p-6 text-center text-sm text-[var(--tm-text-dim)]">
      <div>No design in the embed URL.</div>
      <a className="text-[var(--tm-accent-soft)] hover:underline" href={SANDBOX}>
        Open Breakpoint →
      </a>
    </div>
  );
}

const design = readDesign();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{design ? <Embed design={design} /> : <Missing />}</StrictMode>,
);
