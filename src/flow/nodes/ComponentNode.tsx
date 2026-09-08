import { memo, useCallback, useMemo, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  deriveConcurrency,
  getModel,
  resolveScaleParam,
  tierOf,
  type ComponentType,
  type MemberMetrics,
} from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { useViewStore } from '@/store/viewStore';
import { fmtDuration, fmtPct, fmtRps, HEALTH_COLOR, healthForRho } from '@/lib/format';
import { ComponentIcon } from '../icons';

export interface ComponentNodeData {
  label: string;
  params: Record<string, unknown>;
  zone?: string;
  [key: string]: unknown;
}

const NODE_W = 184;
const EXTERNAL_ACCENT = '#a371f7';
const FRAME_PAD = 6; // room for the grouped dashed frame

/** Compact box spec for compute nodes: a one-line summary + a full derivation
 *  for the hover tooltip. */
function specOf(
  type: ComponentType,
  p: Record<string, unknown>,
): { line: string; title: string } | null {
  if (type !== 'apiServer' && type !== 'worker') return null;
  const s = deriveConcurrency(p);
  const vcpus = Number(p.vcpus ?? 2);
  const ramGB = Number(p.ramGB ?? 4);
  const storage = p.storageGB != null ? Number(p.storageGB) : null;
  const mem = Number.isFinite(s.memSlots) ? String(s.memSlots) : '∞';
  const line = `${vcpus} vCPU · ${ramGB} GB · ${s.concurrency} slots`;
  const title =
    `${vcpus} vCPU × ${Number(p.parallelPerVcpu ?? 8)} = ${s.cpuSlots} CPU slots\n` +
    `${ramGB} GB ÷ ${Number(p.memPerReqMB ?? 40)} MB = ${mem} RAM slots\n` +
    `→ ${s.concurrency} concurrent / instance (${s.bound}-bound)` +
    (storage != null ? `\nstorage ${storage} GB` : '');
  return { line, title };
}

/** How many parallel instances this node represents, plus a human label. */
function replicasOf(type: ComponentType, p: Record<string, unknown>): { count: number; label?: string } {
  if (type === 'apiServer') {
    const n = Math.max(1, Math.round(Number(p.replicas ?? 1)));
    return { count: n, label: n > 1 ? `${n} instances` : undefined };
  }
  if (type === 'worker') {
    const n = Math.max(1, Math.round(Number(p.replicas ?? 1)));
    return { count: n, label: n > 1 ? `${n} workers` : undefined };
  }
  if (type === 'loadBalancer') {
    const n = Math.max(1, Math.round(Number(p.instances ?? 1)));
    return { count: n, label: n > 1 ? `${n} instances` : undefined };
  }
  if (type === 'sqlDatabase') {
    const arch = String(p.architecture ?? 'primary-replica');
    if (arch === 'primary-replica') {
      const r = Math.max(0, Math.round(Number(p.readReplicas ?? 0)));
      return { count: 1, label: r > 0 ? `primary + ${r} read replica${r > 1 ? 's' : ''}` : undefined };
    }
    if (arch === 'multi-primary') {
      const n = Math.max(1, Math.round(Number(p.primaries ?? 3)));
      return { count: 1, label: `${n}× multi-primary` };
    }
    if (arch === 'sharded') {
      const n = Math.max(1, Math.round(Number(p.shards ?? 4)));
      return { count: 1, label: `${n} shards · ${String(p.keyDistribution ?? 'uniform')}` };
    }
    return { count: 1, label: 'single primary' };
  }
  return { count: 1 };
}

function ComponentNodeInner({ id, type, data, selected }: NodeProps) {
  const t = type as ComponentType;
  const d = data as ComponentNodeData;
  const params = d.params;
  const m = useViewStore((s) => s.perNode[id]);
  const faultKind = useSimStore(
    (s) => s.faults.find((f) => f.targetId === id && f.kind !== 'partition')?.kind,
  );
  const updateNodeParams = useDesignStore((s) => s.updateNodeParams);
  const flowDir = useDesignStore((s) => s.flowDir);
  const targetPos = flowDir === 'LR' ? Position.Left : Position.Top;
  const sourcePos = flowDir === 'LR' ? Position.Right : Position.Bottom;
  // Client nodes show the configured load (kept in sync with the scenario bar).
  // Non-client selectors return '' so those nodes never re-render on load edits.
  const clientLoad = useSimStore((s) => {
    if (t !== 'client') return '';
    const sc = s.scenario;
    const base = sc.mode === 'users' ? `${(sc.users ?? 0).toLocaleString()} users` : fmtRps(sc.targetRps);
    return sc.kind === 'wander' ? `${base} · varying` : base;
  });

  // Everything below depends only on `type` + `params` — stable between sim
  // ticks — so memoize it and skip the recompute on every metrics update.
  const { model, tier } = useMemo(() => {
    const mdl = getModel(t);
    return { model: mdl, tier: tierOf(mdl.category) };
  }, [t]);
  const { scale, scaleVal } = useMemo(() => {
    const sc = resolveScaleParam(model, params);
    return { scale: sc, scaleVal: sc ? Math.round(Number(params[sc.key] ?? sc.min)) : 0 };
  }, [model, params]);
  const { count: replicas, label: replicaLabel } = useMemo(
    () => replicasOf(t, params),
    [t, params],
  );
  const spec = useMemo(() => specOf(t, params), [t, params]);

  const bump = useCallback(
    (delta: number) => {
      if (!scale) return;
      const step = scale.step ?? 1;
      updateNodeParams(id, {
        [scale.key]: Math.min(scale.max, Math.max(scale.min, scaleVal + delta * step)),
      });
    },
    [scale, scaleVal, id, updateNodeParams],
  );

  // Is this node flagged by the bottleneck audit? Narrow primitive selector —
  // re-renders only when *this* node's status changes.
  const bottleneck = useViewStore(
    (s) => s.analysis?.bottlenecks.find((b) => b.nodeId === id)?.severity,
  );

  const rho = m?.rho ?? 0;
  const level = healthForRho(rho, m?.overloaded ?? false);
  const health = HEALTH_COLOR[m ? level : 'idle'];
  const hasIn = t !== 'client';
  const hasOut = model.routing !== 'sink';
  const isExternal = tier === 'external';
  const accent = isExternal ? EXTERNAL_ACCENT : health;
  const pulse =
    m?.overloaded || bottleneck === 'critical'
      ? 'tm-pulse-crit'
      : bottleneck === 'warning'
        ? 'tm-pulse-warn'
        : '';
  // 1 → plain card · 2 → one instance peeking to the right · 3 → three cards
  // fanned side-by-side · 4+ → three + a "+N" strip, all inside a dashed frame.
  const grouped = replicas >= 3;
  const realGhosts = Math.min(Math.max(0, replicas - 1), 2); // → up to 3 visible cards
  const overflow = Math.max(0, replicas - 3);
  const STRIP = 18; // width of each fanned-right instance strip
  const OSTRIP = 32; // the "+N" strip is a touch wider
  const pad = grouped ? FRAME_PAD : 0;
  const peek = realGhosts * STRIP + (overflow > 0 ? OSTRIP : 0);

  return (
    <div
      className="relative"
      style={{ width: NODE_W + pad * 2 + peek, padding: pad, paddingRight: pad + peek }}
    >
      {grouped && (
        <div
          className="pointer-events-none absolute rounded-xl border border-dashed"
          style={{ inset: 0, borderColor: 'var(--tm-border-2)' }}
        >
          <span
            className="tabnum absolute -top-2 right-1.5 rounded px-1 text-[9px] text-[var(--tm-text-dim)]"
            style={{ background: 'var(--tm-bg)' }}
          >
            ×{replicas}
          </span>
        </div>
      )}

      {/* fanned instance strips, right of the front card (deepest drawn first) */}
      {overflow > 0 && (
        <div
          className="absolute rounded-lg border"
          style={{
            width: NODE_W,
            top: pad,
            left: pad + realGhosts * STRIP + OSTRIP,
            height: `calc(100% - ${pad * 2}px)`,
            background: 'var(--tm-node-ghost)',
            borderColor: 'var(--tm-border)',
            borderLeftWidth: 3, borderLeftColor: accent, borderLeftStyle: 'solid' as const,
          }}
        >
          <span className="tabnum absolute right-1 top-1 text-[9px] font-semibold text-[var(--tm-text-faint)]">
            +{overflow}
          </span>
        </div>
      )}
      {Array.from({ length: realGhosts }).map((_, i) => {
        const depth = realGhosts - i; // 1 = closest behind the front card
        return (
          <div
            key={i}
            className="absolute rounded-lg border"
            style={{
              width: NODE_W,
              top: pad,
              left: pad + depth * STRIP,
              height: `calc(100% - ${pad * 2}px)`,
              background: 'var(--tm-node-ghost)',
              borderColor: 'var(--tm-border)',
              borderLeftWidth: 3, borderLeftColor: accent, borderLeftStyle: 'solid' as const,
              opacity: 0.55 + i * 0.2,
            }}
          />
        );
      })}

      <div
        className={`relative overflow-hidden rounded-lg border text-[var(--tm-text)] shadow-sm transition-colors ${pulse}`}
        style={{
          width: NODE_W,
          background: isExternal ? 'var(--tm-panel-2)' : 'var(--tm-node)',
          borderColor: selected ? 'var(--tm-accent)' : isExternal ? EXTERNAL_ACCENT : 'var(--tm-border)',
          borderStyle: isExternal ? 'dashed' : 'solid',
          borderLeftWidth: 3, borderLeftColor: accent, borderLeftStyle: 'solid' as const,
        }}
      >
        {hasIn && <Handle type="target" position={targetPos} style={{ background: 'var(--tm-border-2)' }} />}
        {hasOut && (
          <Handle type="source" position={sourcePos} style={{ background: 'var(--tm-border-2)' }} />
        )}

        <div
          className="flex items-center gap-2 px-2.5 pt-2 pb-1.5"
          style={tier === 'infra' ? { background: 'var(--tm-panel-2)' } : undefined}
        >
          <span style={{ color: accent }}>
            <ComponentIcon type={t} />
          </span>
          <span className="truncate text-[13px] font-medium">{d.label}</span>
          {faultKind && (
            <span
              className="shrink-0 rounded px-1 text-[9px] font-semibold uppercase"
              style={{ background: 'var(--tm-crit-bg)', color: 'var(--tm-crit-fg)' }}
              title={`Chaos: ${faultKind}`}
            >
              {faultKind === 'kill' ? '💀' : faultKind === 'slow' ? '🐌' : '⚠'}
            </span>
          )}
          {t === 'apiServer' && d.params.colocatedDb ? (
            <span
              className="shrink-0 rounded bg-[var(--tm-chip)] px-1 text-[9px] font-medium text-[var(--tm-text-dim)]"
              title="Database runs on this box"
            >
              +db
            </span>
          ) : null}
          {t === 'circuitBreaker' ? (
            <BreakerPill state={m?.breakerState} />
          ) : isExternal ? (
            <span
              className="ml-auto rounded px-1 text-[9px] font-medium uppercase tracking-wide"
              style={{ background: 'rgba(163,113,247,0.16)', color: EXTERNAL_ACCENT }}
            >
              3rd party
            </span>
          ) : (
            !grouped &&
            (m?.members?.length ?? replicas) > 1 && (
              <span className="tabnum ml-auto rounded bg-[var(--tm-chip)] px-1 text-[10px] text-[var(--tm-text-dim)]">
                ×{m?.members?.length ?? replicas}
              </span>
            )
          )}
        </div>

        {replicaLabel && (
          <div className="px-2.5 pb-1 text-[10px] text-[var(--tm-text-faint)]">{replicaLabel}</div>
        )}
        {clientLoad && (
          <div className="px-2.5 pb-1 text-[10px] text-[var(--tm-text-faint)]">{clientLoad}</div>
        )}
        {spec && (
          <div
            className="cursor-help truncate px-2.5 pb-1 text-[10px] text-[var(--tm-text-faint)]"
            title={spec.title}
          >
            {spec.line}
          </div>
        )}

        <div className="mx-2.5 h-1 overflow-hidden rounded bg-[var(--tm-border)]">
          <div
            className="h-full rounded transition-all"
            style={{ width: `${Math.min(100, rho * 100)}%`, background: health }}
          />
        </div>

        <div className="tabnum grid grid-cols-2 gap-x-2 gap-y-0.5 px-2.5 pt-1.5 pb-2 text-[11px] text-[var(--tm-text-dim)]">
          <Stat label="ρ" value={m ? rho.toFixed(2) : '—'} />
          <Stat label="in" value={m ? fmtRps(m.arrivalRate) : '—'} />
          <Stat label="p99" value={m ? fmtDuration(m.latency.p99) : '—'} />
          <Stat
            label={m && m.dropRate > 1e-4 ? 'drop' : 'err'}
            value={m ? fmtPct(m.dropRate > 1e-4 ? m.dropRate : m.errorRate) : '—'}
            alert={!!m && (m.dropRate > 0.01 || m.overloaded)}
          />
        </div>

        {m?.members && m.members.length > 1 && <MemberList members={m.members} />}

        {t === 'apiServer' && Boolean(d.params.colocatedDb) && (
          <ColocatedDb params={d.params} serverRho={rho} />
        )}

        {scale && (
          <div className="flex items-center justify-between border-t border-[var(--tm-border)] px-2.5 py-1 text-[10px] text-[var(--tm-text-dim)]">
            <span>{scale.label}</span>
            <span className="flex items-center gap-1.5">
              <StepBtn onClick={() => bump(-1)} disabled={scaleVal <= scale.min}>
                −
              </StepBtn>
              <span className="tabnum w-5 text-center text-[var(--tm-text)]">{scaleVal}</span>
              <StepBtn onClick={() => bump(1)} disabled={scaleVal >= scale.max}>
                +
              </StepBtn>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const StepBtn = memo(function StepBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="flex h-4 w-4 items-center justify-center rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)] disabled:opacity-30"
    >
      {children}
    </button>
  );
});

const MEMBER_CAP = 8;

const MemberList = memo(function MemberList({ members }: { members: MemberMetrics[] }) {
  const shown = members.slice(0, MEMBER_CAP);
  const extra = members.length - shown.length;
  return (
    <div className="flex flex-col gap-0.5 border-t border-[var(--tm-border)] px-2.5 py-1.5">
      {shown.map((mm, i) => {
        const level = healthForRho(mm.rho, mm.rho >= 1);
        const c = HEALTH_COLOR[level];
        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <span
              className="w-14 shrink-0 truncate"
              style={{ color: mm.hot ? HEALTH_COLOR.crit : 'var(--tm-text-faint)' }}
            >
              {mm.label}
            </span>
            <span className="h-1 flex-1 overflow-hidden rounded bg-[var(--tm-border)]">
              <span
                className="block h-full rounded"
                style={{ width: `${Math.min(100, mm.rho * 100)}%`, background: c }}
              />
            </span>
            <span className="tabnum w-8 shrink-0 text-right" style={{ color: c }}>
              {mm.rho.toFixed(2)}
            </span>
            {mm.hot && (
              <span
                className="rounded px-0.5 text-[8px] font-semibold uppercase"
                style={{ background: 'rgba(240,68,52,0.16)', color: HEALTH_COLOR.crit }}
              >
                hot
              </span>
            )}
          </div>
        );
      })}
      {extra > 0 && <div className="text-[9px] text-[var(--tm-text-faint)]">+{extra} more</div>}
    </div>
  );
});

/** The embedded datastore, shown as a sub-component of the box it runs on. */
const ColocatedDb = memo(function ColocatedDb({
  params,
  serverRho,
}: {
  params: Record<string, unknown>;
  serverRho: number;
}) {
  const qpr = Math.max(0, Number(params.queriesPerRequest ?? 3));
  const dqms = Math.max(0, Number(params.dbQueryMs ?? 6));
  const buf = Math.max(0, Number(params.dbBufferGB ?? 1));
  const baseMs = Math.max(0.001, Number(params.serviceTimeMs ?? 40));
  const dbMs = qpr * dqms;
  const share = dbMs / (dbMs + baseMs); // fraction of each request's CPU time
  // The DB's slice of the box's utilization — what you'd get back by moving it off.
  const dbRho = serverRho * share;
  return (
    <div className="border-t border-[var(--tm-border)] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="text-[var(--tm-text-faint)]">
          <ComponentIcon type="sqlDatabase" size={11} />
        </span>
        <span className="text-[var(--tm-text-dim)]">database · on this box</span>
        <span className="tabnum ml-auto text-[var(--tm-text-faint)]">
          {qpr}× · {dqms} ms
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="h-1 flex-1 overflow-hidden rounded bg-[var(--tm-border)]">
          <span
            className="block h-full rounded"
            style={{ width: `${Math.min(100, share * 100)}%`, background: 'var(--tm-accent)' }}
          />
        </span>
        <span className="tabnum w-24 shrink-0 text-right text-[10px] text-[var(--tm-text-faint)]">
          {Math.round(share * 100)}% of svc · ρ {dbRho.toFixed(2)}
        </span>
      </div>
      <div className="mt-0.5 text-[9px] text-[var(--tm-text-faint)]">{buf} GB buffer pool</div>
    </div>
  );
});

const BREAKER_PILL: Record<string, { bg: string; fg: string }> = {
  closed: { bg: 'var(--tm-good-bg)', fg: 'var(--tm-good-fg)' },
  'half-open': { bg: 'var(--tm-warn-bg)', fg: 'var(--tm-warn-fg)' },
  open: { bg: 'var(--tm-crit-bg)', fg: 'var(--tm-crit-fg)' },
};

const BreakerPill = memo(function BreakerPill({ state }: { state?: string }) {
  const s = state ?? 'closed';
  const c = BREAKER_PILL[s] ?? BREAKER_PILL.closed;
  return (
    <span
      className="ml-auto rounded px-1 text-[9px] font-semibold uppercase tracking-wide"
      style={{ background: c.bg, color: c.fg }}
      title={`Circuit breaker is ${s.toUpperCase()}`}
    >
      {s}
    </span>
  );
});

const Stat = memo(function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[var(--tm-text-faint)]">{label}</span>
      <span style={{ color: alert ? HEALTH_COLOR.crit : undefined }}>{value}</span>
    </div>
  );
});

export const ComponentNode = memo(ComponentNodeInner);
