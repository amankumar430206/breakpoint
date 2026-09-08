import { memo, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getModel, resolveScaleParam, tierOf, type ComponentType, type MemberMetrics } from '@/engine';
import { useDesignStore } from '@/store/designStore';
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
  const model = getModel(t);
  const tier = tierOf(model.category);
  const m = useViewStore((s) => s.perNode[id]);
  const updateNodeParams = useDesignStore((s) => s.updateNodeParams);
  const flowDir = useDesignStore((s) => s.flowDir);
  const targetPos = flowDir === 'LR' ? Position.Left : Position.Top;
  const sourcePos = flowDir === 'LR' ? Position.Right : Position.Bottom;

  const scale = resolveScaleParam(model, d.params);
  const scaleVal = scale ? Math.round(Number(d.params[scale.key] ?? scale.min)) : 0;
  const bump = (delta: number) => {
    if (!scale) return;
    const step = scale.step ?? 1;
    updateNodeParams(id, {
      [scale.key]: Math.min(scale.max, Math.max(scale.min, scaleVal + delta * step)),
    });
  };

  const rho = m?.rho ?? 0;
  const level = healthForRho(rho, m?.overloaded ?? false);
  const health = HEALTH_COLOR[m ? level : 'idle'];
  const hasIn = t !== 'client';
  const hasOut = model.routing !== 'sink';
  const isExternal = tier === 'external';
  const accent = isExternal ? EXTERNAL_ACCENT : health;

  const { count: replicas, label: replicaLabel } = replicasOf(t, d.params);
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
            borderLeft: `3px solid ${accent}`,
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
              borderLeft: `3px solid ${accent}`,
              opacity: 0.55 + i * 0.2,
            }}
          />
        );
      })}

      <div
        className="relative overflow-hidden rounded-lg border text-[var(--tm-text)] shadow-sm transition-colors"
        style={{
          width: NODE_W,
          background: isExternal ? 'var(--tm-panel-2)' : 'var(--tm-node)',
          borderColor: selected ? 'var(--tm-accent)' : isExternal ? EXTERNAL_ACCENT : 'var(--tm-border)',
          borderStyle: isExternal ? 'dashed' : 'solid',
          borderLeft: `3px solid ${accent}`,
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
          {t === 'apiServer' && d.params.colocatedDb ? (
            <span
              className="shrink-0 rounded bg-[var(--tm-chip)] px-1 text-[9px] font-medium text-[var(--tm-text-dim)]"
              title="Database runs on this box"
            >
              +db
            </span>
          ) : null}
          {isExternal ? (
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

function StepBtn({
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
}

const MEMBER_CAP = 8;

function MemberList({ members }: { members: MemberMetrics[] }) {
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
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[var(--tm-text-faint)]">{label}</span>
      <span style={{ color: alert ? HEALTH_COLOR.crit : undefined }}>{value}</span>
    </div>
  );
}

export const ComponentNode = memo(ComponentNodeInner);
