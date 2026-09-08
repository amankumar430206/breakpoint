/// <reference lib="webworker" />
import { analyze, solve } from '@/engine';
import { Simulator } from '@/engine/des';
import type { SystemDesign } from '@/engine';
import { TICK_MS, type FromWorker, type ToWorker } from './protocol';

let sim: Simulator | null = null;
let design: SystemDesign | null = null;
let speed = 4;
let timer: ReturnType<typeof setInterval> | null = null;

function post(msg: FromWorker) {
  (self as unknown as Worker).postMessage(msg);
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function tick() {
  if (!sim || !design) return;
  const dt = (speed * TICK_MS) / 1000;
  const end = Math.min(sim.simTime + dt, design.sim.scenario.durationSec);
  sim.advance(end);
  const snap = sim.snapshot();
  if (end >= design.sim.scenario.durationSec) {
    stopTimer();
    post({ type: 'ended', snap });
  } else {
    post({ type: 'snapshot', snap, running: true });
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      stopTimer();
      design = msg.design;
      speed = msg.design.sim.speed || 4;
      // Analytical steady state + optimization audit — the heavy synchronous
      // work, done here so the UI thread never blocks.
      const result = solve(design);
      const analysis = analyze(design, result);
      post({ type: 'analysis', result, analysis });
      sim = new Simulator(design);
      if (msg.running) timer = setInterval(tick, TICK_MS);
      break;
    }
    case 'play':
      if (sim && !timer) timer = setInterval(tick, TICK_MS);
      break;
    case 'pause':
      stopTimer();
      break;
    case 'reset':
      stopTimer();
      if (design) sim = new Simulator(design);
      if (sim) post({ type: 'snapshot', snap: sim.snapshot(), running: false });
      break;
    case 'setSpeed':
      speed = Math.max(0.25, msg.speed);
      break;
  }
};
