import type { Edge, Node } from '@xyflow/react';
import {
  DESIGN_SCHEMA_VERSION,
  type ComponentType,
  type EdgeParams,
  type SimConfig,
  type SystemDesign,
} from '@/engine';

export interface TmNodeData {
  label: string;
  params: Record<string, unknown>;
  zone?: string;
  [key: string]: unknown;
}

export type TmNode = Node<TmNodeData>;
export type TmEdge = Edge<{ params: EdgeParams } & Record<string, unknown>>;

/** React Flow graph → engine `SystemDesign`. */
export function toDesign(
  nodes: TmNode[],
  edges: TmEdge[],
  sim: SimConfig,
  meta: { name?: string; description?: string; notes?: string } = {},
): SystemDesign {
  return {
    version: DESIGN_SCHEMA_VERSION,
    name: meta.name ?? 'Untitled design',
    description: meta.description,
    notes: meta.notes,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as ComponentType,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      label: n.data.label,
      zone: n.data.zone,
      params: n.data.params ?? {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      params: e.data?.params ?? {},
    })),
    sim,
  };
}

/** Engine `SystemDesign` → React Flow graph. */
export function fromDesign(design: SystemDesign): { nodes: TmNode[]; edges: TmEdge[] } {
  return {
    nodes: design.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { label: n.label ?? n.type, params: n.params, zone: n.zone },
    })),
    edges: design.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      type: 'flow',
      data: { params: e.params },
    })),
  };
}
