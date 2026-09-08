import { useCallback, useEffect, useState } from 'react';
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
import type { ComponentType } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { useThemeStore } from '@/store/themeStore';
import { ComponentNode } from './nodes/ComponentNode';
import { FlowEdge } from './edges/FlowEdge';
import { ContextMenu, type MenuState } from './ContextMenu';

const nodeTypes: NodeTypes = {
  client: ComponentNode,
  loadBalancer: ComponentNode,
  apiServer: ComponentNode,
  cache: ComponentNode,
  sqlDatabase: ComponentNode,
  queue: ComponentNode,
  worker: ComponentNode,
  cdn: ComponentNode,
  objectStore: ComponentNode,
  externalService: ComponentNode,
  circuitBreaker: ComponentNode,
  shardRouter: ComponentNode,
};

const edgeTypes: EdgeTypes = { flow: FlowEdge };

/**
 * The canvas passes the raw design graph straight to React Flow — no per-frame
 * decoration. Live metrics reach each node/edge through `useViewStore`, so a
 * metrics update re-renders only the components whose numbers changed, and the
 * `nodes`/`edges` array identity stays stable while the simulation runs.
 */
export function Canvas() {
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

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => selectNode(n.id)}
        onEdgeClick={(_, e) => selectEdge(e.id)}
        onPaneClick={() => selectNode(null)}
        onNodeContextMenu={(e, n) => openMenu('node', e, n.id)}
        onEdgeContextMenu={(e, ed) => openMenu('edge', e, ed.id)}
        onPaneContextMenu={(e) => openMenu('pane', e as React.MouseEvent)}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        fitView
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'flow' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--tm-dot-grid)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  );
}
