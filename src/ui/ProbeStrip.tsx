import { useState } from 'react';
import { useDesignStore } from '@/store/designStore';
import { useViewStore } from '@/store/viewStore';
import { useProbeStore } from '@/store/probeStore';
import { CALIBRATABLE_TYPES } from '@/live/calibration';
import { MAX_DURATION_SEC, MAX_RPS, MAX_USERS } from '@/live/targetPolicy';
import { ProbeTargetForm } from './ProbeTargetForm';

const num =
  'w-16 rounded border border-[var(--tm-border-2)] bg-[var(--tm-node)] px-1.5 py-0.5 text-right text-[11px] text-[var(--tm-text)] outline-none focus:border-[var(--tm-accent)]';

/** Live-probe run controls + status + results, shown at the top of the Monitor
 *  panel. Operates on the currently-selected node. */
export function ProbeStrip() {
  const [editing, setEditing] = useState(false);

  const nodeId = useDesignStore((s) => s.selectedNodeId);
  const node = useDesignStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId));
  const probeable = !!node?.type && CALIBRATABLE_TYPES.includes(node.type);

  const target = useProbeStore((s) => (nodeId ? s.targets[nodeId] : undefined));
  const config = useProbeStore((s) => s.config);
  const setConfig = useProbeStore((s) => s.setConfig);
  const status = useProbeStore((s) => s.status);
  const error = useProbeStore((s) => s.error);
  const activeNodeId = useProbeStore((s) => s.activeNodeId);
  const last = useProbeStore((s) => (s.series.length ? s.series[s.series.length - 1] : null));
  const result = useProbeStore((s) => s.result);
  const calibrated = useProbeStore((s) => (nodeId ? s.calibration[nodeId] : undefined));
  const start = useProbeStore((s) => s.start);
  const stop = useProbeStore((s) => s.stop);
  const dismissResult = useProbeStore((s) => s.dismissResult);
  const calibrateFromResult = useProbeStore((s) => s.calibrateFromResult);
  const clearCalibration = useProbeStore((s) => s.clearCalibration);

  const modelP99 = useViewStore((s) => (nodeId ? s.perNode[nodeId]?.latency.p99 : undefined));

  if (!node) {
    return (
      <div className="border-b border-[var(--tm-border)] px-3 py-1.5 text-[10px] text-[var(--tm-text-faint)]">
        Select a node to see its metrics.
      </div>
    );
  }
  if (!probeable) return null;

  const running = status === 'running' && activeNodeId === nodeId;
  const doneHere = status === 'done' && result?.nodeId === nodeId;

  return (
    <div className="flex flex-col gap-1.5 border-b border-[var(--tm-border)] bg-[var(--tm-panel-2)] px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-medium uppercase tracking-wide text-[var(--tm-text-faint)]">
          Live probe
        </span>
        {target?.url ? (
          <button
            onClick={() => setEditing(true)}
            className="flex min-w-0 items-center gap-1 text-[var(--tm-text-dim)] hover:text-[var(--tm-text)]"
            title="Edit endpoint"
          >
            <span className="rounded bg-[var(--tm-chip)] px-1 text-[9px] font-semibold">
              {target.method}
            </span>
            <span className="truncate">{target.url}</span>
            <span className="text-[var(--tm-text-faint)]">✎</span>
          </button>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded border border-[var(--tm-accent-border)] bg-[var(--tm-accent-bg)] px-2 py-0.5 text-[var(--tm-accent-soft)]"
          >
            Configure endpoint
          </button>
        )}
      </div>

      {target?.url && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded border border-[var(--tm-border-2)]">
            {(['rps', 'users'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setConfig({ mode: m })}
                className="px-1.5 py-0.5 text-[10px]"
                style={{
                  background: config.mode === m ? 'var(--tm-chip-active)' : 'transparent',
                  color: config.mode === m ? 'var(--tm-text)' : 'var(--tm-text-faint)',
                }}
              >
                {m === 'rps' ? 'RPS' : 'Users'}
              </button>
            ))}
          </div>
          {config.mode === 'rps' ? (
            <label className="flex items-center gap-1 text-[var(--tm-text-faint)]">
              <input
                type="number"
                min={1}
                max={MAX_RPS}
                value={config.targetRps}
                onChange={(e) => setConfig({ targetRps: Number(e.target.value) })}
                className={num}
              />
              req/s
            </label>
          ) : (
            <label className="flex items-center gap-1 text-[var(--tm-text-faint)]">
              <input
                type="number"
                min={1}
                max={MAX_USERS}
                value={config.users}
                onChange={(e) => setConfig({ users: Number(e.target.value) })}
                className={num}
              />
              users
            </label>
          )}
          <label className="flex items-center gap-1 text-[var(--tm-text-faint)]">
            for
            <input
              type="number"
              min={1}
              max={MAX_DURATION_SEC}
              value={config.durationSec}
              onChange={(e) => setConfig({ durationSec: Number(e.target.value) })}
              className={num}
            />
            s
          </label>
          {running ? (
            <button
              onClick={stop}
              className="ml-auto rounded border border-[var(--tm-crit-border)] bg-[var(--tm-crit-bg)] px-2 py-0.5 font-medium text-[var(--tm-crit-fg)]"
            >
              ■ Stop
            </button>
          ) : (
            <button
              onClick={() => nodeId && start(nodeId)}
              className="ml-auto rounded bg-[var(--tm-accent)] px-2.5 py-0.5 font-medium text-white"
            >
              ▶ Run probe
            </button>
          )}
        </div>
      )}

      {running && last && (
        <div className="tabnum text-[var(--tm-text-dim)]">
          achieved {last.achievedRps.toFixed(0)}/s · in-flight {last.inFlight} · err{' '}
          {(last.errorRate * 100).toFixed(1)}% · {last.t.toFixed(0)}s / {config.durationSec}s
        </div>
      )}

      {status === 'error' && error && activeNodeId === nodeId && (
        <div className="rounded bg-[var(--tm-crit-bg)] px-2 py-1 text-[var(--tm-crit-fg)]">{error}</div>
      )}

      {doneHere && result && (
        <div className="flex flex-col gap-1 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] p-2">
          <div className="tabnum text-[var(--tm-text-dim)]">
            measured p50 {result.p50.toFixed(0)} · p90 {result.p90.toFixed(0)} · p99{' '}
            {result.p99.toFixed(0)} ms · err {(result.errorRate * 100).toFixed(1)}% ·{' '}
            {result.totalRequests.toLocaleString()} reqs
            {result.stoppedEarly ? ' · stopped early' : ''}
          </div>
          {modelP99 != null && Number.isFinite(modelP99) && modelP99 > 0 && (
            <div className="tabnum text-[10px] text-[var(--tm-text-faint)]">
              model p99{calibrated ? ' (calibrated)' : ''} {(modelP99 * 1000).toFixed(0)} ms
              {!calibrated && (
                <>
                  {' '}
                  · measured is{' '}
                  {(((result.p99 - modelP99 * 1000) / (modelP99 * 1000)) * 100).toFixed(0)}%{' '}
                  {result.p99 >= modelP99 * 1000 ? 'higher' : 'lower'}
                </>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => nodeId && calibrateFromResult(nodeId)}
              className="rounded border border-[var(--tm-accent-border)] bg-[var(--tm-accent-bg)] px-2 py-0.5 text-[var(--tm-accent-soft)]"
            >
              Calibrate model from run
            </button>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(JSON.stringify(result, null, 2));
              }}
              className="text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
            >
              Copy JSON
            </button>
            <button
              onClick={dismissResult}
              className="ml-auto text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {calibrated && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--tm-good-fg)]">
          <span>● model calibrated from measurement</span>
          <button
            onClick={() => nodeId && clearCalibration(nodeId)}
            className="text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
          >
            reset
          </button>
        </div>
      )}

      {editing && nodeId && <ProbeTargetForm nodeId={nodeId} onClose={() => setEditing(false)} />}
    </div>
  );
}
