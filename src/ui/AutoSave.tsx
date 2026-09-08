import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { toDesign } from '@/lib/design';
import { newProjectId, saveProject } from '@/lib/projectStore';

/**
 * Debounced browser-local autosave of the working design. Renders nothing — it
 * exists so that `App` does not have to subscribe to `nodes` / `edges` (which
 * would re-render the whole tree on every edit and every drag frame).
 */
export function AutoSave({
  title,
  onSaved,
}: {
  title: string;
  onSaved: Dispatch<SetStateAction<string | null>>;
}) {
  const nodes = useDesignStore((s) => s.nodes);
  const edges = useDesignStore((s) => s.edges);
  const scenario = useSimStore((s) => s.scenario);
  const seed = useSimStore((s) => s.seed);

  useEffect(() => {
    if (nodes.length === 0) return;
    const t = setTimeout(() => {
      const { speed } = useSimStore.getState();
      const design = toDesign(nodes, edges, { scenario, seed, speed }, { name: title });
      onSaved((cur) => {
        const id = cur ?? newProjectId();
        saveProject(design, id);
        return id;
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [nodes, edges, scenario, seed, title, onSaved]);

  return null;
}
