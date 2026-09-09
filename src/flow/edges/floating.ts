import { Position, type InternalNode } from '@xyflow/react';

/**
 * "Floating" edge geometry — instead of anchoring to a fixed Top/Bottom (or
 * Left/Right) handle, an edge attaches to whichever border of each node faces
 * the other node. Works for any layout: horizontal, vertical, branching, or a
 * node dragged anywhere. Adapted from React Flow's floating-edges example.
 */

function centre(n: InternalNode) {
  const w = n.measured.width ?? 0;
  const h = n.measured.height ?? 0;
  return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + h / 2, w, h };
}

/** Point where the line from `node`'s centre to `other`'s centre crosses
 *  `node`'s rectangle border. */
function borderPoint(node: InternalNode, other: InternalNode) {
  const a = centre(node);
  const b = centre(other);
  const w = a.w / 2;
  const h = a.h / 2;
  const x2 = a.x;
  const y2 = a.y;
  const x1 = b.x;
  const y1 = b.y;
  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const denom = Math.abs(xx1) + Math.abs(yy1);
  const s = denom === 0 ? 0 : 1 / denom;
  const xx3 = s * xx1;
  const yy3 = s * yy1;
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

function side(node: InternalNode, pt: { x: number; y: number }): Position {
  const nx = node.internals.positionAbsolute.x;
  const ny = node.internals.positionAbsolute.y;
  const nw = node.measured.width ?? 0;
  if (pt.x <= nx + 1) return Position.Left;
  if (pt.x >= nx + nw - 1) return Position.Right;
  if (pt.y <= ny + 1) return Position.Top;
  return Position.Bottom;
}

export function getEdgeParams(source: InternalNode, target: InternalNode) {
  const s = borderPoint(source, target);
  const t = borderPoint(target, source);
  return {
    sx: s.x,
    sy: s.y,
    tx: t.x,
    ty: t.y,
    sourcePos: side(source, s),
    targetPos: side(target, t),
  };
}
