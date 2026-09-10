import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { SystemDesign } from '@/engine';
import { Canvas } from '@/flow/Canvas';
import { TopBar } from '@/ui/TopBar';
import { ScenarioBar } from '@/ui/ScenarioBar';
import { Palette } from '@/ui/Palette';
import { RightPanel } from '@/ui/RightPanel';
import { EmptyState } from '@/ui/EmptyState';
import { BottleneckPanel } from '@/ui/BottleneckPanel';
import { ChaosBar } from '@/ui/ChaosBar';
import { CalibrationBar } from '@/ui/CalibrationBar';
import { AutoSave } from '@/ui/AutoSave';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { useSimWorker } from '@/store/simWorker';
import { useProbe } from '@/live/useProbe';
import { useThemeStore } from '@/store/themeStore';
import { fromDesign } from '@/lib/design';
import { designFromHash } from '@/lib/shareUrl';
import { randomDesign } from '@/lib/randomDesign';
import { getPreset } from '@/presets';

export function App() {
  // Only the count — a primitive — so App does NOT re-render on every node/edge
  // edit or drag frame (autosave's nodes/edges subscription lives in <AutoSave/>).
  const nodeCount = useDesignStore((s) => s.nodes.length);
  const replaceGraph = useDesignStore((s) => s.replaceGraph);
  const loadSim = useSimStore((s) => s.loadSim);
  const reset = useSimStore((s) => s.reset);
  const [title, setTitle] = useState('Untitled design');
  const [projectId, setProjectId] = useState<string | null>(null);
  const theme = useThemeStore((s) => s.theme);

  useSimWorker();
  useProbe();

  const applyDesign = useCallback(
    (design: SystemDesign, id: string | null = null) => {
      const { nodes, edges } = fromDesign(design);
      replaceGraph(nodes, edges);
      loadSim(design.sim);
      setTitle(design.name);
      setProjectId(id);
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

  const startNew = useCallback(() => {
    reset();
    replaceGraph([], []);
    setTitle('Untitled design');
    setProjectId(null);
  }, [reset, replaceGraph]);

  const randomize = useCallback(() => applyDesign(randomDesign()), [applyDesign]);
  const openProject = useCallback(
    (design: SystemDesign, id: string) => applyDesign(design, id),
    [applyDesign],
  );
  const handleImport = useCallback((d: SystemDesign) => applyDesign(d), [applyDesign]);

  return (
    <ReactFlowProvider>
      <div className={`flex h-full flex-col overflow-hidden ${theme === 'light' ? 'tm-light' : ''}`}>
        <AutoSave title={title} onSaved={setProjectId} />
        <TopBar
          title={title}
          hasDesign={nodeCount > 0}
          projectId={projectId}
          onNew={startNew}
          onRandomize={randomize}
          onLoadPreset={loadPreset}
          onImport={handleImport}
          onOpenProject={openProject}
          onProjectSaved={setProjectId}
          onTitleChange={setTitle}
        />
        <ScenarioBar />
        <div className="flex min-h-0 flex-1">
          <Palette />
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <Canvas />
            {nodeCount === 0 ? (
              <EmptyState
                onLoaded={setTitle}
                onLoadPreset={loadPreset}
                onRandomize={randomize}
                onOpenProject={openProject}
              />
            ) : (
              <BottleneckPanel />
            )}
            {nodeCount > 0 && (
              <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
                <CalibrationBar />
                <ChaosBar />
              </div>
            )}
          </main>
          {nodeCount > 0 && <RightPanel />}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
