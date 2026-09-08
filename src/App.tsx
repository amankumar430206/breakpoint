import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { SystemDesign } from '@/engine';
import { Canvas } from '@/flow/Canvas';
import { TopBar } from '@/ui/TopBar';
import { ScenarioBar } from '@/ui/ScenarioBar';
import { Palette } from '@/ui/Palette';
import { Inspector } from '@/ui/Inspector';
import { EmptyState } from '@/ui/EmptyState';
import { BottleneckPanel } from '@/ui/BottleneckPanel';
import { MetricsDrawer } from '@/ui/MetricsDrawer';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { useSimWorker } from '@/store/simWorker';
import { useThemeStore } from '@/store/themeStore';
import { fromDesign } from '@/lib/design';
import { designFromHash } from '@/lib/shareUrl';
import { randomDesign } from '@/lib/randomDesign';
import { getPreset } from '@/presets';

export function App() {
  const nodeCount = useDesignStore((s) => s.nodes.length);
  const replaceGraph = useDesignStore((s) => s.replaceGraph);
  const loadSim = useSimStore((s) => s.loadSim);
  const reset = useSimStore((s) => s.reset);
  const [title, setTitle] = useState('Untitled design');
  const theme = useThemeStore((s) => s.theme);

  useSimWorker();

  const applyDesign = useCallback(
    (design: SystemDesign) => {
      const { nodes, edges } = fromDesign(design);
      replaceGraph(nodes, edges);
      loadSim(design.sim);
      setTitle(design.name);
    },
    [replaceGraph, loadSim],
  );

  const loadPreset = useCallback(
    (id: string) => {
      const design = getPreset(id);
      if (design) applyDesign(design);
    },
    [applyDesign],
  );

  useEffect(() => {
    // Start on the empty canvas unless a design was shared via the URL.
    const shared = designFromHash();
    if (shared) applyDesign(shared);
  }, [applyDesign]);

  const startNew = () => {
    reset();
    replaceGraph([], []);
    setTitle('Untitled design');
  };

  const randomize = () => applyDesign(randomDesign());

  return (
    <ReactFlowProvider>
      <div
        className={`flex h-full flex-col overflow-hidden ${theme === 'light' ? 'tm-light' : ''}`}
      >
        <TopBar
          title={title}
          hasDesign={nodeCount > 0}
          onNew={startNew}
          onRandomize={randomize}
          onLoadPreset={loadPreset}
          onImport={applyDesign}
          onTitleChange={setTitle}
        />
        <ScenarioBar />
        <div className="flex min-h-0 flex-1">
          <Palette />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              <Canvas />
              {nodeCount === 0 ? (
                <EmptyState onLoaded={setTitle} onLoadPreset={loadPreset} onRandomize={randomize} />
              ) : (
                <BottleneckPanel />
              )}
            </div>
            {nodeCount > 0 && <MetricsDrawer />}
          </main>
          <Inspector />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
