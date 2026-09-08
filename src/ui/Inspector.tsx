import { useMemo } from 'react';
import { getModel } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { useViewStore } from '@/store/viewStore';
import {
  chipValue,
  describeSchema,
  fieldPresets,
  prettyLabel,
  stepFor,
  type FieldDesc,
} from '@/lib/schemaForm';
import type { ComponentModel } from '@/engine';
import { fmtDuration, fmtPct, fmtRps } from '@/lib/format';
import { Spinner } from './Spinner';

const USER_PRESETS = [100, 1_000, 10_000, 100_000];
const RPS_PRESETS = [100, 1_000, 10_000, 50_000];

export function Inspector() {
  // Identity-stable selectors: `find` returns the existing node/edge object (or
  // null), so the Inspector re-renders only on selection change or when the
  // selected entity itself changes — it leaves the drag / sim-tick paths.
  const node = useDesignStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId) ?? null);
  const edge = useDesignStore((s) => s.edges.find((e) => e.id === s.selectedEdgeId) ?? null);
  const updateNodeParams = useDesignStore((s) => s.updateNodeParams);
  const updateNodeLabel = useDesignStore((s) => s.updateNodeLabel);
  const updateEdgeParams = useDesignStore((s) => s.updateEdgeParams);
  const removeNode = useDesignStore((s) => s.removeNode);
  const computing = useViewStore((s) => s.computing);

  // Take up no space when nothing is selected — the canvas gets it back.
  if (!node && !edge) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-[var(--tm-border)] bg-[var(--tm-panel)]">
      {computing && (
        <div className="flex items-center gap-1.5 border-b border-[var(--tm-border)] bg-[var(--tm-panel-2)] px-3 py-1.5 text-[11px] text-[var(--tm-text-faint)]">
          <Spinner size={11} /> recalculating…
        </div>
      )}
      {node && node.type !== 'client' && (
        <StandardSizes
          model={getModel(node.type as never)}
          params={node.data.params}
          onPatch={(p) => updateNodeParams(node.id, p)}
        />
      )}
      {node && node.type === 'client' && (
        <ClientInspector
          key={node.id}
          label={node.data.label}
          onLabel={(v) => updateNodeLabel(node.id, v)}
          onDelete={() => removeNode(node.id)}
        />
      )}
      {node && node.type !== 'client' && (
        <NodeInspector
          key={node.id}
          nodeId={node.id}
          type={node.type as never}
          label={node.data.label}
          params={node.data.params}
          onLabel={(v) => updateNodeLabel(node.id, v)}
          onParam={(patch) => updateNodeParams(node.id, patch)}
          onDelete={() => removeNode(node.id)}
        />
      )}
      {edge && (
        <EdgeInspector
          key={edge.id}
          edgeId={edge.id}
          params={(edge.data?.params ?? {}) as Record<string, unknown>}
          onParam={(patch) => updateEdgeParams(edge.id, patch)}
        />
      )}
    </aside>
  );
}

/** Sticky "standard instance" row — quick-pick param bundles, kept in view
 *  while the rest of the inspector scrolls. */
function StandardSizes({
  model,
  params,
  onPatch,
}: {
  model: ComponentModel;
  params: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  if (!model.presets?.length) return null;
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-1 border-b border-[var(--tm-border)] bg-[var(--tm-panel)] px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
          standard instance
        </span>
        {model.presetLegend && (
          <span className="text-[9px] text-[var(--tm-text-faint)]">{model.presetLegend}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {model.presets.map((ps) => {
          const active = Object.entries(ps.patch).every(([k, v]) => params[k] === v);
          return (
            <button
              key={ps.label}
              title={ps.hint}
              onClick={() => onPatch(ps.patch)}
              className="tabnum rounded px-1.5 py-0.5 text-[10px]"
              style={{
                background: active ? 'var(--tm-chip-active)' : 'var(--tm-chip)',
                color: active ? 'var(--tm-accent-soft)' : 'var(--tm-text-dim)',
              }}
            >
              {ps.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NodeInspector({
  nodeId,
  type,
  label,
  params,
  onLabel,
  onParam,
  onDelete,
}: {
  nodeId: string;
  type: Parameters<typeof getModel>[0];
  label: string;
  params: Record<string, unknown>;
  onLabel: (v: string) => void;
  onParam: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const m = useViewStore((s) => s.perNode[nodeId]);
  const explain = useViewStore((s) => s.explains[nodeId]);
  const model = getModel(type);
  const fields = useMemo(
    () =>
      describeSchema(model.paramSchema)
        .filter((f) => f.default !== undefined || model.paramDocs[f.key])
        .filter((f) => !model.fieldVisible || model.fieldVisible(f.key, params)),
    [model, params],
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">{model.label}</div>
        <input
          value={label}
          onChange={(e) => onLabel(e.target.value)}
          className="w-full rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1 text-sm text-[var(--tm-text)] outline-none focus:border-[var(--tm-accent)]"
        />
      </div>

      {m && (
        <div className="tabnum grid grid-cols-2 gap-1 rounded border border-[var(--tm-border)] bg-[var(--tm-panel-2)] p-2 text-[11px]">
          <Metric label="utilization ρ" value={m.rho.toFixed(3)} alert={m.rho >= 1} />
          <Metric label="arrivals" value={fmtRps(m.arrivalRate)} />
          <Metric label="p50 / p99" value={`${fmtDuration(m.latency.p50)} / ${fmtDuration(m.latency.p99)}`} />
          <Metric label="in queue" value={m.inQueue.toFixed(1)} />
          <Metric label="drop" value={fmtPct(m.dropRate)} alert={m.dropRate > 0.01} />
          <Metric label="error" value={fmtPct(m.errorRate)} alert={m.errorRate > 0.02} />
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {fields.map((f) => (
          <Field
            key={f.key}
            f={f}
            value={params[f.key] ?? f.default}
            doc={model.paramDocs[f.key]}
            onChange={(v) => onParam({ [f.key]: v })}
          />
        ))}
      </div>

      {explain?.length ? (
        <div className="flex flex-col gap-1.5 rounded border border-[var(--tm-border)] bg-[var(--tm-panel-2)] p-2 text-[11px] text-[var(--tm-text-dim)]">
          <div className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">why</div>
          {explain.map((e, i) => (
            <p key={i} className="leading-snug">
              {e.text}
              {e.formula ? <span className="tabnum mt-0.5 block text-[var(--tm-text-faint)]">{e.formula}</span> : null}
            </p>
          ))}
        </div>
      ) : null}

      <button
        onClick={onDelete}
        className="mt-1 rounded border border-[var(--tm-crit-border)] bg-[var(--tm-crit-bg)] px-2 py-1 text-xs text-[var(--tm-crit-fg)] hover:bg-[var(--tm-crit-bg)]"
      >
        Delete component
      </button>
    </div>
  );
}

/**
 * The client node edits the run's offered load — the *same* scenario config the
 * bar at the top drives (one source of truth in `simStore`). Shape, duration and
 * seed stay in the bar; this panel is just "how much traffic".
 */
function ClientInspector({
  label,
  onLabel,
  onDelete,
}: {
  label: string;
  onLabel: (v: string) => void;
  onDelete: () => void;
}) {
  const scenario = useSimStore((s) => s.scenario);
  const setMode = useSimStore((s) => s.setMode);
  const setUsers = useSimStore((s) => s.setUsers);
  const setTargetRps = useSimStore((s) => s.setTargetRps);
  const setThinkTime = useSimStore((s) => s.setThinkTime);
  const setScenarioKind = useSimStore((s) => s.setScenarioKind);
  const setPeakFactor = useSimStore((s) => s.setPeakFactor);
  const offeredRps = useViewStore((s) => s.system.offeredRps);
  const servedRps = useViewStore((s) => s.system.servedRps);

  const usersMode = scenario.mode === 'users';
  const users = scenario.users ?? 0;
  const thinkTime = scenario.thinkTimeSec ?? 1;
  const effectiveRps = offeredRps || users / thinkTime;
  const varying = scenario.kind === 'wander';
  const swing = scenario.peakFactor ?? 3;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
          Client · traffic source
        </div>
        <input
          value={label}
          onChange={(e) => onLabel(e.target.value)}
          className="w-full rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1 text-sm text-[var(--tm-text)] outline-none focus:border-[var(--tm-accent)]"
        />
      </div>

      <div className="flex overflow-hidden rounded border border-[var(--tm-border)] text-[11px]">
        {(['rps', 'users'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="flex-1 py-1"
            style={{
              background: scenario.mode === m ? 'var(--tm-chip-active)' : 'var(--tm-panel-2)',
              color: scenario.mode === m ? 'var(--tm-accent-soft)' : 'var(--tm-text-dim)',
            }}
          >
            {m === 'rps' ? 'Fixed RPS' : 'Concurrent users'}
          </button>
        ))}
      </div>

      {usersMode ? (
        <>
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="flex items-center justify-between">
              <span className="text-[var(--tm-text-dim)]">Users</span>
              <span className="tabnum text-[var(--tm-text)]">{users.toLocaleString()}</span>
            </span>
            <input
              type="range"
              min={1}
              max={100000}
              step={1}
              value={users}
              onChange={(e) => setUsers(Number(e.target.value))}
              className="accent-[var(--tm-accent)]"
            />
          </label>
          <div className="flex gap-1">
            {USER_PRESETS.map((n) => (
              <button
                key={n}
                onClick={() => setUsers(n)}
                className="tabnum flex-1 rounded py-0.5 text-[10px]"
                style={{
                  background: users === n ? 'var(--tm-chip-active)' : 'var(--tm-chip)',
                  color: users === n ? 'var(--tm-accent-soft)' : 'var(--tm-text-dim)',
                }}
              >
                {n >= 1000 ? `${n / 1000}k` : n}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-[var(--tm-text-dim)]">Think time</span>
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={0.05}
                max={60}
                step={0.05}
                value={thinkTime}
                onChange={(e) => setThinkTime(Number(e.target.value))}
                className="w-16 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-1 py-0.5 text-right text-[var(--tm-text)] outline-none"
              />
              <span className="text-[var(--tm-text-faint)]">s</span>
            </span>
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="flex items-center justify-between">
              <span className="text-[var(--tm-text-dim)]">Requests / sec</span>
              <span className="tabnum text-[var(--tm-text)]">{fmtRps(scenario.targetRps)}</span>
            </span>
            <input
              type="range"
              min={10}
              max={50000}
              step={10}
              value={scenario.targetRps}
              onChange={(e) => setTargetRps(Number(e.target.value))}
              className="accent-[var(--tm-accent)]"
            />
          </label>
          <div className="flex gap-1">
            {RPS_PRESETS.map((r) => (
              <button
                key={r}
                onClick={() => setTargetRps(r)}
                className="tabnum flex-1 rounded py-0.5 text-[10px]"
                style={{
                  background: scenario.targetRps === r ? 'var(--tm-chip-active)' : 'var(--tm-chip)',
                  color: scenario.targetRps === r ? 'var(--tm-accent-soft)' : 'var(--tm-text-dim)',
                }}
              >
                {fmtRps(r).replace('/s', '')}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex flex-col gap-2 rounded border border-[var(--tm-border)] bg-[var(--tm-panel-2)] p-2">
        <label className="flex items-center justify-between text-[11px]">
          <span className="text-[var(--tm-text-dim)]">
            Vary {usersMode ? 'users' : 'load'} over the run
          </span>
          <button
            onClick={() => {
              if (varying) setScenarioKind('constant');
              else {
                setScenarioKind('wander');
                if ((scenario.peakFactor ?? 1) <= 1) setPeakFactor(3);
              }
            }}
            className="rounded px-2 py-0.5 text-[11px]"
            style={{
              background: varying ? 'var(--tm-good-bg)' : 'var(--tm-btn-hover)',
              color: varying ? 'var(--tm-good-fg)' : 'var(--tm-text-dim)',
            }}
          >
            {varying ? 'on' : 'off'}
          </button>
        </label>
        {varying && (
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="flex items-center justify-between">
              <span className="text-[var(--tm-text-faint)]">swing (baseline → up to)</span>
              <span className="tabnum text-[var(--tm-text)]">×{swing.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={1.2}
              max={10}
              step={0.1}
              value={swing}
              onChange={(e) => setPeakFactor(Number(e.target.value))}
              className="accent-[var(--tm-accent)]"
            />
          </label>
        )}
      </div>

      <div className="tabnum grid grid-cols-2 gap-1 rounded border border-[var(--tm-border)] bg-[var(--tm-panel-2)] p-2 text-[11px]">
        <Metric label={usersMode || varying ? '≈ offered' : 'offered'} value={fmtRps(effectiveRps)} />
        <Metric label="served" value={fmtRps(servedRps)} />
      </div>

      <p className="text-[10px] leading-snug text-[var(--tm-text-faint)]">
        The offered load — the same control as the scenario bar. “Vary” drives realistic traffic
        noise (the <span className="text-[var(--tm-text-dim)]">Wander</span> scenario); the ramp /
        spike shapes, duration and seed live in the bar.
      </p>

      <button
        onClick={onDelete}
        className="mt-1 rounded border border-[var(--tm-crit-border)] bg-[var(--tm-crit-bg)] px-2 py-1 text-xs text-[var(--tm-crit-fg)]"
      >
        Delete component
      </button>
    </div>
  );
}

function EdgeInspector({
  edgeId,
  params,
  onParam,
}: {
  edgeId: string;
  params: Record<string, unknown>;
  onParam: (patch: Record<string, unknown>) => void;
}) {
  const em = useViewStore((s) => s.perEdge[edgeId]);
  const flow = em?.flow ?? 0;
  const retry = em?.retryFactor ?? 1;
  const fields: FieldDesc[] = [
    { key: 'weight', kind: 'number', min: 0, default: 1 },
    { key: 'retries', kind: 'number', min: 0, max: 8, int: true, default: 0 },
    { key: 'timeoutSec', kind: 'number', min: 0, max: 30, default: 0 },
    { key: 'backoffSec', kind: 'number', min: 0, max: 10, default: 0 },
    { key: 'callsPerRequest', kind: 'number', min: 0, max: 20, default: 1 },
  ];
  const docs: Record<string, string> = {
    weight: 'Relative share of traffic for weighted routing at a load balancer.',
    retries: 'Extra attempts on failure — watch the retry-storm amplification.',
    timeoutSec: 'Per-attempt timeout (0 = none).',
    backoffSec: 'Base delay between retries.',
    callsPerRequest: 'Downstream calls per upstream request (fan-out).',
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">Connection</div>
      <div className="tabnum rounded border border-[var(--tm-border)] bg-[var(--tm-panel-2)] p-2 text-[11px]">
        <Metric label="flow" value={fmtRps(flow)} />
        <Metric label="retry factor" value={`×${retry.toFixed(2)}`} alert={retry > 1.05} />
      </div>
      <div className="flex flex-col gap-2.5">
        {fields.map((f) => (
          <Field
            key={f.key}
            f={f}
            value={params[f.key] ?? f.default}
            doc={docs[f.key]}
            onChange={(v) => onParam({ [f.key]: v })}
          />
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-[var(--tm-text-faint)]">{label}</span>
      <span style={{ color: alert ? 'var(--tm-crit-fg)' : 'var(--tm-text)' }}>{value}</span>
    </div>
  );
}

function Field({
  f,
  value,
  doc,
  onChange,
}: {
  f: FieldDesc;
  value: unknown;
  doc?: string;
  onChange: (v: unknown) => void;
}) {
  const presets = f.kind === 'number' ? fieldPresets(f) : [];
  return (
    <label className="flex flex-col gap-1 text-[11px]">
      <span className="flex items-center justify-between">
        <span className="text-[var(--tm-text-dim)]">{prettyLabel(f.key)}</span>
        {f.kind === 'number' && (
          <span className="tabnum text-[var(--tm-text)]">{typeof value === 'number' ? value : '—'}</span>
        )}
      </span>

      {f.kind === 'boolean' && (
        <button
          onClick={() => onChange(!value)}
          className="self-start rounded px-2 py-0.5 text-[11px]"
          style={{
            background: value ? 'var(--tm-good-bg)' : 'var(--tm-btn-hover)',
            color: value ? 'var(--tm-good-fg)' : 'var(--tm-text-dim)',
          }}
        >
          {value ? 'on' : 'off'}
        </button>
      )}

      {f.kind === 'enum' && (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1 text-[var(--tm-text)] outline-none focus:border-[var(--tm-accent)]"
        >
          {f.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}

      {f.kind === 'number' && (
        <input
          type="range"
          min={f.min ?? 0}
          max={f.max ?? (typeof value === 'number' ? Math.max(value * 3, 10) : 100)}
          step={stepFor(f)}
          value={typeof value === 'number' ? value : (f.min ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="accent-[var(--tm-accent)]"
        />
      )}

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {presets.map((pv) => (
            <button
              key={pv}
              type="button"
              onClick={() => onChange(pv)}
              className="tabnum rounded px-1 py-0.5 text-[9px]"
              style={{
                background: value === pv ? 'var(--tm-chip-active)' : 'var(--tm-chip)',
                color: value === pv ? 'var(--tm-accent-soft)' : 'var(--tm-text-faint)',
              }}
            >
              {chipValue(pv)}
            </button>
          ))}
        </div>
      )}

      {f.kind === 'string' && (
        <input
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1 text-[var(--tm-text)] outline-none focus:border-[var(--tm-accent)]"
        />
      )}

      {doc && <span className="leading-snug text-[var(--tm-text-faint)]">{doc}</span>}
    </label>
  );
}
