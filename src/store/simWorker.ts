import { useEffect, useMemo, useRef } from 'react';
import { applyFaults, type Fault } from '@/engine';
import { applyCalibration, type CalibrationMap } from '@/live/calibration';
import type { FromWorker, ToWorker } from '@/worker/protocol';
import { toDesign } from '@/lib/design';
import { useDesignStore } from './designStore';
import { useProbeStore } from './probeStore';
import { useSimStore } from './simStore';
import { useViewStore } from './viewStore';

/** Structural fingerprint — everything the solver/simulator depends on, and
 *  nothing it doesn't (node positions, selection, labels are excluded so
 *  dragging a node never triggers a recompute). */
function designSignature(
  nodes: ReturnType<typeof useDesignStore.getState>['nodes'],
  edges: ReturnType<typeof useDesignStore.getState>['edges'],
  scenario: unknown,
  seed: number,
  faults: Fault[],
  calibration: CalibrationMap,
): string {
  const n = nodes
    .map((x) => `${x.id}:${x.type}:${JSON.stringify(x.data.params)}:${x.data.zone ?? ''}`)
    .sort()
    .join('|');
  const e = edges
    .map((x) => `${x.id}:${x.source}>${x.target}:${JSON.stringify(x.data?.params ?? {})}`)
    .sort()
    .join('|');
  const f = faults
    .map((x) => `${x.id}:${x.magnitude ?? ''}`)
    .sort()
    .join('|');
  return `${n}#${e}#${JSON.stringify(scenario)}#${seed}#${f}#${JSON.stringify(calibration)}`;
}

/**
 * Owns the singleton compute/simulation worker. All solving, optimization
 * analysis and discrete-event simulation happen off the main thread; results
 * stream into `useViewStore`. Mount once near the app root.
 */
export function useSimWorker(): void {
  const workerRef = useRef<Worker | null>(null);
  const nodes = useDesignStore((s) => s.nodes);
  const edges = useDesignStore((s) => s.edges);
  const scenario = useSimStore((s) => s.scenario);
  const seed = useSimStore((s) => s.seed);
  const speed = useSimStore((s) => s.speed);
  const running = useSimStore((s) => s.running);
  const faults = useSimStore((s) => s.faults);
  const calibration = useProbeStore((s) => s.calibration);
  const pause = useSimStore((s) => s.pause);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      const view = useViewStore.getState();
      if (msg.type === 'analysis') {
        view.applyAnalytical(msg.result, msg.analysis, useSimStore.getState().running);
      } else if (msg.type === 'snapshot') {
        view.applySnapshot(msg.snap, false);
      } else if (msg.type === 'ended') {
        view.applySnapshot(msg.snap, true);
        pause();
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [pause]);

  const send = (msg: ToWorker) => workerRef.current?.postMessage(msg);

  const signature = useMemo(
    () => designSignature(nodes, edges, scenario, seed, faults, calibration),
    [nodes, edges, scenario, seed, faults, calibration],
  );

  // Debounce re-init so dragging a slider coalesces into one recompute.
  useEffect(() => {
    const id = setTimeout(() => {
      useViewStore.getState().setComputing(true);
      send({
        type: 'init',
        design: applyCalibration(
          applyFaults(toDesign(nodes, edges, { scenario, seed, speed }), faults),
          calibration,
        ),
        running,
      });
    }, 90);
    // Failsafe: never leave the indicator stuck if the worker doesn't answer.
    const failsafe = setTimeout(() => useViewStore.getState().setComputing(false), 15000);
    return () => {
      clearTimeout(id);
      clearTimeout(failsafe);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    send({ type: running ? 'play' : 'pause' });
  }, [running]);

  useEffect(() => {
    send({ type: 'setSpeed', speed });
  }, [speed]);
}
