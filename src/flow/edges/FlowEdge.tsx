import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import { useViewStore } from '@/store/viewStore';
import { useSimStore } from '@/store/simStore';
import { fmtRps } from '@/lib/format';
import { getEdgeParams } from './floating';

function FlowEdgeInner({ id, source, target, selected }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const metrics = useViewStore((s) => s.perEdge[id]);
  const running = useSimStore((s) => s.running);
  const flow = metrics?.flow ?? 0;
  const retry = metrics?.retryFactor ?? 1;
  const timeoutRate = metrics?.timeoutRate ?? 0;
  const width = flow <= 0 ? 1 : Math.min(6, 1 + Math.log10(1 + flow) * 1.1);
  const stroke = selected
    ? 'var(--tm-accent)'
    : timeoutRate > 0.02
      ? 'var(--tm-crit-fg)'
      : retry > 1.05
        ? 'var(--tm-warn-fg)'
        : 'var(--tm-border-2)';

  if (!sourceNode || !targetNode) return null;
  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke,
          strokeWidth: width,
          strokeDasharray: running ? '6 6' : undefined,
          animation: running && flow > 0 ? 'tm-dash 1s linear infinite' : undefined,
        }}
      />
      {(flow > 0 || retry > 1.05 || timeoutRate > 0.02) && (
        <EdgeLabelRenderer>
          <div
            className="tabnum pointer-events-none absolute rounded bg-[var(--tm-node)]/90 px-1 text-[10px] text-[var(--tm-text-dim)]"
            style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}
          >
            {fmtRps(flow)}
            {retry > 1.05 && <span className="ml-1 text-[var(--tm-warn-fg)]">×{retry.toFixed(2)}</span>}
            {timeoutRate > 0.02 && (
              <span className="ml-1 text-[var(--tm-crit-fg)]">⏱{Math.round(timeoutRate * 100)}%</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeInner);
