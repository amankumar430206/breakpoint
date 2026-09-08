import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { defaultParamsFor, getModel, type ComponentType } from '@/engine';
import type { TmEdge, TmNode } from '@/lib/design';
import { autoLayout, type FlowDir } from '@/lib/layout';

const DIR_KEY = 'tm-flow-dir';
const initialDir = (): FlowDir => {
  try {
    return localStorage.getItem(DIR_KEY) === 'LR' ? 'LR' : 'TB';
  } catch {
    return 'TB';
  }
};
const applyPositions = (
  nodes: TmNode[],
  pos: Record<string, { x: number; y: number }>,
): TmNode[] => nodes.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n));

let seq = 0;
const genId = (prefix: string) => {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${seq}${rand}`;
};

interface DesignState {
  nodes: TmNode[];
  edges: TmEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  flowDir: FlowDir;

  setFlowDir: (dir: FlowDir) => void;
  toggleFlowDir: () => void;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;

  addNode: (type: ComponentType, position: { x: number; y: number }) => string;
  updateNodeParams: (id: string, patch: Record<string, unknown>) => void;
  updateNodeLabel: (id: string, label: string) => void;
  updateEdgeParams: (id: string, patch: Record<string, unknown>) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  duplicateNode: (id: string) => void;
  resetNodeParams: (id: string) => void;
  reverseEdge: (id: string) => void;
  resetEdgeParams: (id: string) => void;
  setPositions: (pos: Record<string, { x: number; y: number }>) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  replaceGraph: (nodes: TmNode[], edges: TmEdge[]) => void;
}

export const useDesignStore = create<DesignState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  flowDir: initialDir(),

  setFlowDir: (dir) => {
    try {
      localStorage.setItem(DIR_KEY, dir);
    } catch {
      /* private mode — keep it in memory only */
    }
    const { nodes, edges } = get();
    set({ flowDir: dir, nodes: applyPositions(nodes, autoLayout(nodes, edges, dir)) });
  },
  toggleFlowDir: () => get().setFlowDir(get().flowDir === 'TB' ? 'LR' : 'TB'),

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) as TmNode[] }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) as TmEdge[] }),
  onConnect: (conn) =>
    set({
      edges: addEdge(
        { ...conn, type: 'flow', data: { params: {} } },
        get().edges,
      ) as TmEdge[],
    }),

  addNode: (type, position) => {
    const id = genId(type);
    const model = getModel(type);
    const node: TmNode = {
      id,
      type,
      position,
      data: { label: model.label, params: defaultParamsFor(type) },
    };
    set({ nodes: [...get().nodes, node], selectedNodeId: id, selectedEdgeId: null });
    return id;
  },

  updateNodeParams: (id, patch) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, ...patch } } } : n,
      ),
    }),

  updateNodeLabel: (id, label) =>
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)),
    }),

  updateEdgeParams: (id, patch) =>
    set({
      edges: get().edges.map((e) =>
        e.id === id
          ? { ...e, data: { ...e.data, params: { ...(e.data?.params ?? {}), ...patch } } }
          : e,
      ),
    }),

  removeNode: (id) =>
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    }),

  removeEdge: (id) =>
    set({
      edges: get().edges.filter((e) => e.id !== id),
      selectedEdgeId: get().selectedEdgeId === id ? null : get().selectedEdgeId,
    }),

  duplicateNode: (id) => {
    const src = get().nodes.find((n) => n.id === id);
    if (!src) return;
    const nid = genId(src.type ?? 'node');
    const copy: TmNode = {
      ...src,
      id: nid,
      position: { x: src.position.x + 48, y: src.position.y + 48 },
      selected: false,
      data: { ...src.data, params: structuredClone(src.data.params) },
    };
    set({ nodes: [...get().nodes, copy], selectedNodeId: nid, selectedEdgeId: null });
  },

  resetNodeParams: (id) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, params: defaultParamsFor(n.type as ComponentType) } } : n,
      ),
    }),

  reverseEdge: (id) =>
    set({
      edges: get().edges.map((e) =>
        e.id === id ? { ...e, source: e.target, target: e.source } : e,
      ),
    }),

  resetEdgeParams: (id) =>
    set({
      edges: get().edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, params: {} } } : e)),
    }),

  setPositions: (pos) =>
    set({
      nodes: get().nodes.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n)),
    }),

  selectNode: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),
  replaceGraph: (nodes, edges) => {
    // presets / random / imports are authored top-to-bottom — re-flow them if
    // the user prefers left-to-right.
    const dir = get().flowDir;
    const laidOut = dir === 'TB' ? nodes : applyPositions(nodes, autoLayout(nodes, edges, dir));
    set({ nodes: laidOut, edges, selectedNodeId: null, selectedEdgeId: null });
  },
}));

