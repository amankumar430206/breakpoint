import { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { allModels, resolveScaleParam, getModel, type ComponentType } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { autoLayout } from '@/lib/layout';
import { ComponentIcon } from './icons';

export interface MenuState {
  kind: 'node' | 'edge' | 'pane';
  x: number;
  y: number;
  /** client coords, for pane "add here" */
  clientX: number;
  clientY: number;
  id?: string;
}

export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const s = useDesignStore();
  const { fitView, screenToFlowPosition, zoomTo } = useReactFlow();
  const [addOpen, setAddOpen] = useState(false);

  if (!menu) return null;

  const node = menu.id ? s.nodes.find((n) => n.id === menu.id) : undefined;
  const close = () => {
    setAddOpen(false);
    onClose();
  };
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  const scale = node ? resolveScaleParam(getModel(node.type as ComponentType), node.data.params) : undefined;
  const scaleVal = scale ? Math.round(Number(node!.data.params[scale.key] ?? scale.min)) : 0;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={close} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="fixed z-50 min-w-[184px] overflow-hidden rounded-md border border-[var(--tm-border-2)] bg-[var(--tm-panel)] py-1 text-xs shadow-xl"
        style={{ left: menu.x, top: menu.y }}
      >
        {menu.kind === 'node' && node && (
          <>
            <Item onClick={run(() => s.duplicateNode(node.id))}>Duplicate</Item>
            <Item onClick={run(() => s.selectNode(node.id))}>Inspect / rename</Item>
            {scale && (
              <>
                <Item onClick={run(() => s.updateNodeParams(node.id, { [scale.key]: Math.min(scale.max, scaleVal + 1) }))}>
                  Scale up ({scale.label} {scaleVal} → {Math.min(scale.max, scaleVal + 1)})
                </Item>
                <Item
                  disabled={scaleVal <= scale.min}
                  onClick={run(() => s.updateNodeParams(node.id, { [scale.key]: Math.max(scale.min, scaleVal - 1) }))}
                >
                  Scale down ({scale.label} {scaleVal} → {Math.max(scale.min, scaleVal - 1)})
                </Item>
              </>
            )}
            <Item onClick={run(() => s.resetNodeParams(node.id))}>Reset parameters</Item>
            <Divider />
            <Item danger onClick={run(() => s.removeNode(node.id))}>
              Delete component
            </Item>
          </>
        )}

        {menu.kind === 'edge' && menu.id && (
          <>
            <Item onClick={run(() => s.reverseEdge(menu.id!))}>Reverse direction</Item>
            <Item onClick={run(() => s.resetEdgeParams(menu.id!))}>Clear retries &amp; timeout</Item>
            <Item onClick={run(() => s.selectEdge(menu.id!))}>Inspect connection</Item>
            <Divider />
            <Item danger onClick={run(() => s.removeEdge(menu.id!))}>
              Delete connection
            </Item>
          </>
        )}

        {menu.kind === 'pane' && (
          <>
            <Item onClick={() => setAddOpen((v) => !v)}>{addOpen ? '▾ Add component' : '▸ Add component'}</Item>
            {addOpen && (
              <div className="max-h-64 overflow-y-auto border-y border-[var(--tm-border)] bg-[var(--tm-panel-2)] py-1">
                {allModels().map((m) => (
                  <button
                    key={m.type}
                    className="flex w-full items-center gap-2 px-3 py-1 text-left text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)]"
                    onClick={run(() =>
                      s.addNode(
                        m.type as ComponentType,
                        screenToFlowPosition({ x: menu.clientX, y: menu.clientY }),
                      ),
                    )}
                  >
                    <span className="text-[var(--tm-text-faint)]">
                      <ComponentIcon type={m.type as ComponentType} size={14} />
                    </span>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            <Divider />
            <Item onClick={run(() => s.setPositions(autoLayout(s.nodes, s.edges, s.flowDir)))}>
              Auto-layout ({s.flowDir === 'LR' ? 'horizontal' : 'vertical'})
            </Item>
            <Item onClick={run(s.toggleFlowDir)}>
              Switch to {s.flowDir === 'LR' ? 'vertical' : 'horizontal'} flow
            </Item>
            <Item onClick={run(() => fitView({ padding: 0.25, duration: 250 }))}>Fit view</Item>
            <Item onClick={run(() => zoomTo(1, { duration: 200 }))}>Reset zoom</Item>
          </>
        )}
      </div>
    </>
  );
}

function Item({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center px-3 py-1.5 text-left hover:bg-[var(--tm-btn-hover)] disabled:opacity-40"
      style={{ color: danger ? 'var(--tm-crit-fg)' : 'var(--tm-text)' }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-[var(--tm-border)]" />;
}
