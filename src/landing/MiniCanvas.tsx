import { memo, useId } from 'react';
import type { SystemDesign } from '@/engine';
import { HEALTH_COLOR, healthForRho } from '@/lib/format';
import { ComponentIcon } from '@/flow/icons';

const BOX_W = 138;
const BOX_H = 56;
const PAD = 26;

interface Props {
  design: SystemDesign;
  /** node id → utilization (0–1). Omit for a static, design-time render. */
  rho?: Record<string, number>;
  over?: Record<string, boolean>;
  /** animate the edges as flowing traffic */
  flow?: boolean;
}

function subLabelOf(type: string, params: Record<string, unknown>): string | null {
  if ((type === 'apiServer' || type === 'worker') && Number(params.replicas ?? 1) > 1)
    return `×${Math.round(Number(params.replicas))}`;
  if (type === 'loadBalancer' && Number(params.instances ?? 1) > 1)
    return `×${Math.round(Number(params.instances))}`;
  if (type === 'sqlDatabase') {
    const a = String(params.architecture ?? 'primary-replica');
    if (a === 'primary-replica') {
      const r = Math.round(Number(params.readReplicas ?? 0));
      return r > 0 ? `primary +${r} replica${r > 1 ? 's' : ''}` : 'single primary';
    }
    if (a === 'sharded') return `${Math.round(Number(params.shards ?? 4))} shards`;
    if (a === 'multi-primary') return `${Math.round(Number(params.primaries ?? 3))}× primary`;
    return 'single';
  }
  if (type === 'cache' && params.hitRatio != null)
    return `${Math.round(Number(params.hitRatio) * 100)}% hit`;
  if (type === 'externalService') return '3rd party';
  return null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function MiniCanvasInner({ design, rho, over, flow = false }: Props) {
  const uid = useId().replace(/[:]/g, '');
  const pos = new Map(design.nodes.map((n) => [n.id, n.position]));

  const xs = design.nodes.map((n) => n.position.x);
  const ys = design.nodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs) + BOX_W;
  const maxY = Math.max(...ys) + BOX_H;
  const vbW = maxX - minX + PAD * 2;
  const vbH = maxY - minY + PAD * 2;

  return (
    <svg
      className="lp-minicanvas"
      viewBox={`${minX - PAD} ${minY - PAD} ${vbW} ${vbH}`}
      role="img"
      aria-label={`Architecture: ${design.nodes.map((n) => n.label ?? n.type).join(' → ')}`}
    >
      <defs>
        <marker
          id={`arw-${uid}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="var(--tm-border-2)" />
        </marker>
      </defs>

      {design.edges.map((e) => {
        const s = pos.get(e.source);
        const t = pos.get(e.target);
        if (!s || !t) return null;
        const rightward = t.x > s.x + BOX_W / 2;
        const sx = rightward ? s.x + BOX_W : s.x + BOX_W / 2;
        const sy = s.y + BOX_H / 2;
        const tx = rightward ? t.x : t.x + BOX_W / 2;
        const ty = t.y + BOX_H / 2;
        const dx = Math.max(28, Math.abs(tx - sx) * 0.5);
        const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
        return (
          <g key={e.id}>
            <path className="lp-edge" d={d} markerEnd={`url(#arw-${uid})`} />
            {flow && rho && <path className="lp-edge-flow" d={d} />}
          </g>
        );
      })}

      {design.nodes.map((n) => {
        const p = n.position;
        const r = rho?.[n.id];
        const isOver = over?.[n.id] ?? false;
        const level = r == null ? 'idle' : healthForRho(r, isOver);
        const health = HEALTH_COLOR[level];
        const accent = r == null ? 'var(--tm-border-2)' : health;
        const sub = subLabelOf(n.type, n.params ?? {});
        const innerW = BOX_W - 20;
        return (
          <g key={n.id} transform={`translate(${p.x} ${p.y})`}>
            <rect
              className="lp-node-box"
              width={BOX_W}
              height={BOX_H}
              rx="9"
              style={level === 'crit' ? { stroke: health } : undefined}
            />
            <rect width="3.5" height={BOX_H} rx="1.75" fill={accent} />
            <g transform="translate(11 9)" style={{ color: r == null ? 'var(--tm-text-faint)' : health }}>
              <ComponentIcon type={n.type} size={15} />
            </g>
            <text className="lp-node-label" x="31" y="20">
              {truncate(n.label ?? n.type, 15)}
            </text>
            {sub && (
              <text className="lp-node-sub" x="31" y="33">
                {sub}
              </text>
            )}
            {r != null && (
              <>
                <rect className="lp-bar-track" x="10" y={BOX_H - 12} width={innerW} height="4" rx="2" />
                <rect
                  className="lp-bar-fill"
                  x="10"
                  y={BOX_H - 12}
                  width={Math.max(0, Math.min(1, r)) * innerW}
                  height="4"
                  rx="2"
                  fill={health}
                />
                <text
                  className="lp-node-val"
                  x={BOX_W - 10}
                  y="20"
                  textAnchor="end"
                  fill={health}
                >
                  {isOver ? 'ρ 1.0+' : `ρ ${r.toFixed(2)}`}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export const MiniCanvas = memo(MiniCanvasInner);
