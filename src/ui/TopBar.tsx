import { memo } from 'react';
import type { SystemDesign } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { useViewStore } from '@/store/viewStore';
import { useThemeStore } from '@/store/themeStore';
import { fmtDuration, fmtPct, fmtRps } from '@/lib/format';
import { PRESETS } from '@/presets';
import { HelpTip } from './HelpTip';
import { ShareMenu } from './ShareMenu';
import { ProjectsMenu } from './ProjectsMenu';
import { Spinner } from './Spinner';

export const TopBar = memo(function TopBar({
  title,
  hasDesign,
  projectId,
  onNew,
  onRandomize,
  onLoadPreset,
  onImport,
  onOpenProject,
  onProjectSaved,
  onTitleChange,
}: {
  title: string;
  hasDesign: boolean;
  projectId: string | null;
  onNew: () => void;
  onRandomize: () => void;
  onLoadPreset: (id: string) => void;
  onImport: (d: SystemDesign) => void;
  onOpenProject: (d: SystemDesign, id: string) => void;
  onProjectSaved: (id: string) => void;
  onTitleChange: (t: string) => void;
}) {
  const running = useSimStore((s) => s.running);
  const play = useSimStore((s) => s.play);
  const pause = useSimStore((s) => s.pause);
  const reset = useSimStore((s) => s.reset);
  const flowDir = useDesignStore((s) => s.flowDir);
  const toggleFlowDir = useDesignStore((s) => s.toggleFlowDir);
  const themePref = useThemeStore((s) => s.pref);
  const theme = useThemeStore((s) => s.theme);
  const cycleTheme = useThemeStore((s) => s.cycle);

  return (
    <header className="flex items-center gap-x-3 overflow-x-auto border-b border-[var(--tm-border)] bg-[var(--tm-panel)] px-4 py-2 text-sm">
      <a
        href="../"
        className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-[var(--tm-text)] no-underline hover:opacity-80"
        title="Back to the landing page"
      >
        <span className="text-[var(--tm-accent)]">◉</span> Breakpoint
      </a>
      <div className="shrink-0 text-[var(--tm-text-faint)]">/</div>
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        spellCheck={false}
        aria-label="Design name"
        className="w-[16ch] min-w-[8ch] shrink rounded border border-transparent bg-transparent px-1 py-0.5 text-[var(--tm-text)] outline-none hover:border-[var(--tm-border)] focus:w-[22ch] focus:border-[var(--tm-accent)] focus:bg-[var(--tm-node)]"
      />
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          e.target.value = '';
          if (v === '__blank__') onNew();
          else if (v) onLoadPreset(v);
        }}
        className="shrink-0 rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-1.5 py-1 text-xs text-[var(--tm-text-dim)] outline-none hover:bg-[var(--tm-btn-hover)]"
        title="Load a template"
      >
        <option value="">Templates ▾</option>
        <option value="__blank__">Blank canvas</option>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.design.name}
          </option>
        ))}
      </select>
      <button
        onClick={onNew}
        className="shrink-0 rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-2 py-1 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn-hover)]"
        title="Start a new blank design"
      >
        ＋ New
      </button>
      <button
        onClick={onRandomize}
        className="shrink-0 rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-2 py-1 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn-hover)]"
        title="Generate a random system + scenario"
      >
        🎲 Random
      </button>
      <ProjectsMenu
        title={title}
        currentId={projectId}
        hasDesign={hasDesign}
        onOpen={onOpenProject}
        onSaved={onProjectSaved}
      />
      <ShareMenu title={title} onImport={onImport} />
      <a
        href="../wiki/"
        target="_blank"
        rel="noreferrer"
        title="System Design Wiki — what each component is, when to use it, what it pairs with"
        className="shrink-0 rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-2 py-1 text-xs text-[var(--tm-text-dim)] no-underline hover:bg-[var(--tm-btn-hover)]"
      >
        Learn
      </a>

      <button
        onClick={running ? pause : play}
        disabled={!hasDesign}
        className="ml-1 shrink-0 rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-3 py-1 text-xs font-medium text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)] disabled:pointer-events-none disabled:opacity-40"
        title={hasDesign ? '' : 'Add components first'}
      >
        {running ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button
        onClick={reset}
        disabled={!hasDesign}
        className="shrink-0 rounded border border-[var(--tm-border-2)] px-2 py-1 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn)] disabled:pointer-events-none disabled:opacity-40"
        title="Reset simulation"
      >
        ⟲
      </button>
      <button
        onClick={toggleFlowDir}
        disabled={!hasDesign}
        className="shrink-0 rounded border border-[var(--tm-border-2)] px-2 py-1 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn)] disabled:pointer-events-none disabled:opacity-40"
        title={`Flow direction: ${flowDir === 'LR' ? 'horizontal (left → right)' : 'vertical (top → bottom)'} — click to switch and re-layout`}
      >
        {flowDir === 'LR' ? '→' : '↓'} flow
      </button>
      <button
        onClick={cycleTheme}
        className="shrink-0 rounded border border-[var(--tm-border-2)] px-2 py-1 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn)]"
        title={`Theme: ${themePref}${themePref === 'system' ? ` (${theme})` : ''} — click to cycle system / dark / light`}
      >
        {themePref === 'system' ? '◐' : theme === 'dark' ? '☀' : '☾'}
      </button>

      <LiveKpis />
    </header>
  );
});

/**
 * Live system KPIs. Isolated as a leaf so it is the *only* thing that
 * re-renders with the ~15 Hz simulation snapshots — the top-bar chrome around
 * it renders once. Every value sits in a fixed-width slot so changing numbers
 * (e.g. under a varying load) never reflow the header.
 */
function LiveKpis() {
  const system = useViewStore((s) => s.system);
  const converged = useViewStore((s) => s.converged);
  const warnings = useViewStore((s) => s.warnings);
  const computing = useViewStore((s) => s.computing);
  const err = warnings.find((w) => w.level === 'error');

  return (
    <div className="tabnum ml-auto flex shrink-0 items-center gap-2.5 pl-3 text-xs">
      {computing && (
        <span className="inline-flex items-center gap-1 text-[var(--tm-text-faint)]">
          <Spinner size={11} />
          solving…
        </span>
      )}
      <Kpi
        label="offered"
        value={fmtRps(system.offeredRps)}
        tip="Requests per second entering the system (after retries)."
      />
      <Kpi
        label="served"
        value={fmtRps(system.servedRps)}
        tip="Requests per second that completed successfully — offered minus drops and errors."
      />
      <Kpi
        label="p99"
        value={fmtDuration(system.latency.p99)}
        alert={!Number.isFinite(system.latency.p99)}
        tip="99th-percentile end-to-end latency along the slowest client→sink path. ∞ means a node is saturated with an unbounded queue."
      />
      <Kpi
        label="success"
        value={fmtPct(system.successRate)}
        alert={system.successRate < 0.99}
        tip="Share of offered requests that got a good response. Drops (429/503) and errors both count against it."
      />
      <span
        className="w-[4.5rem] shrink-0 rounded px-2 py-0.5 text-center text-[11px]"
        style={{
          background: err ? 'var(--tm-crit-bg)' : system.healthy ? 'var(--tm-good-bg)' : 'var(--tm-warn-bg)',
          color: err ? 'var(--tm-crit-fg)' : system.healthy ? 'var(--tm-good-fg)' : 'var(--tm-warn-fg)',
        }}
      >
        {err ? 'invalid' : system.healthy ? 'healthy' : converged ? 'degraded' : 'unstable'}
      </span>
    </div>
  );
}

function Kpi({
  label,
  value,
  alert,
  tip,
}: {
  label: string;
  value: string;
  alert?: boolean;
  tip?: string;
}) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
        {tip ? (
          <HelpTip text={tip} align="right">
            {label}
          </HelpTip>
        ) : (
          label
        )}
      </span>
      <span
        className="inline-block w-[6.5ch] text-right"
        style={{ color: alert ? 'var(--tm-crit-fg)' : 'var(--tm-text)' }}
      >
        {value}
      </span>
    </div>
  );
}
