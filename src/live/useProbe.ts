import { useEffect, useRef } from 'react';
import { useProbeStore } from '@/store/probeStore';
import type { FromProbe } from './probeProtocol';

/**
 * Owns the singleton Live Probe worker. Forwards `probeStore.command` to it and
 * routes samples / summary / errors back into the store. Mount once near the app
 * root, next to `useSimWorker()`. Completely independent of the sim worker.
 */
export function useProbe(): void {
  const workerRef = useRef<Worker | null>(null);
  const command = useProbeStore((s) => s.command);

  useEffect(() => {
    const worker = new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FromProbe>) => {
      const msg = e.data;
      const store = useProbeStore.getState();
      if (msg.type === 'sample') store.pushSample(msg.point);
      else if (msg.type === 'done') store.finishRun(msg.result);
      else if (msg.type === 'error') store.failRun(msg.message);
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!command) return;
    workerRef.current?.postMessage(command.msg);
    useProbeStore.getState().clearCommand();
  }, [command]);
}
