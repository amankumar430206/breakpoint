import { memo, useCallback, useEffect, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { allModels, type ComponentType } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { useThemeStore } from '@/store/themeStore';
import { ComponentNode } from './nodes/ComponentNode';
import { FlowEdge } from './edges/FlowEdge';
import { ContextMenu, type MenuState } from './ContextMenu';

// Every registered component renders through the one ComponentNode — derive the
// map from the registry so a new component never falls back to React Flow's
// (unthemed, white) default node.
const nodeTypes: NodeTypes = Object.fromEntries(
  allModels().map((m) => [m.type, ComponentNode]),
);

const edgeTypes: EdgeTypes = { flow: FlowEdge };
const DEFAULT_EDGE_OPTIONS = { type: 'flow' };

/**
 * The canvas passes the raw design graph straight to React Flow — no per-frame
 * decoration. Live metrics reach each node/edge through `useViewStore`, so a
 * metrics update re-renders only the components whose numbers changed, and the
 * `nodes`/`edges` array identity stays stable while the simulation runs.
 */
function CanvasInner({ readOnly = false }: { readOnly?: boolean }) {
  const nodes = useDesignStore((s) => s.nodes);
  const edges = useDesignStore((s) => s.edges);
  const onNodesChange = useDesignStore((s) => s.onNodesChange);
  const onEdgesChange = useDesignStore((s) => s.onEdgesChange);
  const onConnect = useDesignStore((s) => s.onConnect);
  const selectNode = useDesignStore((s) => s.selectNode);
  const selectEdge = useDesignStore((s) => s.selectEdge);
  const addNode = useDesignStore((s) => s.addNode);
  const flowDir = useDesignStore((s) => s.flowDir);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const theme = useThemeStore((s) => s.theme);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = useCallback(
    (kind: MenuState['kind'], e: React.MouseEvent, id?: string) => {
      e.preventDefault();
      const pad = 8;
      setMenu({
        kind,
        x: Math.min(e.clientX, window.innerWidth - 220),
        y: Math.min(e.clientY, window.innerHeight - 260) + pad,
        clientX: e.clientX,
        clientY: e.clientY,
        id,
      });
    },
    [],
  );

  // Chromium can skip restyling React Flow's transformed viewport when a CSS
  // custom property changes on an ancestor — force one recalc on theme change.
  useEffect(() => {
    const vp = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!vp) return;
    vp.style.display = 'none';
    void vp.offsetHeight;
    vp.style.display = '';
  }, [theme]);

  const fitKey = `${nodes.length}:${nodes[0]?.id ?? ''}:${flowDir}`;
  useEffect(() => {
    if (nodes.length === 0) return;
    const id = setTimeout(() => fitView({ padding: 0.25, duration: 250 }), 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/tm-component') as ComponentType;
      if (!type) return;
      addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [screenToFlowPosition, addNode],
  );

  const onNodeClick = useCallback((_: unknown, n: { id: string }) => selectNode(n.id), [selectNode]);
  const onEdgeClick = useCallback((_: unknown, e: { id: string }) => selectEdge(e.id), [selectEdge]);
  const onPaneClick = useCallback(() => selectNode(null), [selectNode]);
  const onNodeCtx = useCallback(
    (e: React.MouseEvent, n: { id: string }) => openMenu('node', e, n.id),
    [openMenu],
  );
  const onEdgeCtx = useCallback(
    (e: React.MouseEvent, ed: { id: string }) => openMenu('edge', e, ed.id),
    [openMenu],
  );
  const onPaneCtx = useCallback(
    (e: MouseEvent | React.MouseEvent) => openMenu('pane', e as React.MouseEvent),
    [openMenu],
  );
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const ro = readOnly
    ? {
        nodesDraggable: false,
        nodesConnectable: false,
        elementsSelectable: false,
        panOnDrag: true,
        zoomOnScroll: true,
      }
    : {};

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onEdgesChange={readOnly ? undefined : onEdgesChange}
        onConnect={readOnly ? undefined : onConnect}
        onNodeClick={readOnly ? undefined : onNodeClick}
        onEdgeClick={readOnly ? undefined : onEdgeClick}
        onPaneClick={readOnly ? undefined : onPaneClick}
        onNodeContextMenu={readOnly ? undefined : onNodeCtx}
        onEdgeContextMenu={readOnly ? undefined : onEdgeCtx}
        onPaneContextMenu={readOnly ? undefined : onPaneCtx}
        onDrop={readOnly ? undefined : onDrop}
        onDragOver={readOnly ? undefined : onDragOver}
        fitView
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        {...ro}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--tm-dot-grid)" />
        {!readOnly && <Controls showInteractive={false} />}
      </ReactFlow>
      {!readOnly && menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </>
  );
}

export const Canvas = memo(CanvasInner);
