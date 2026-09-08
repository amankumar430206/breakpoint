import { create } from 'zustand';
import { faultId } from '@/engine';
import type { Fault, FaultKind, LoadMode, ScenarioConfig, ScenarioKind, SimConfig } from '@/engine';

export const DEFAULT_SCENARIO: ScenarioConfig = {
  kind: 'constant',
  mode: 'users',
  targetRps: 500,
  users: 500,
  thinkTimeSec: 1,
  durationSec: 120,
  peakFactor: 8,
};

interface SimState extends SimConfig {
  running: boolean;
  /** Simulated seconds elapsed (advanced by the DES; 0 for pure analytical view). */
  clock: number;
  /** Transient chaos overlay — applied to the design before it reaches the engines. */
  faults: Fault[];

  /** Add a fault, or remove it if the same kind already targets that id (toggle). */
  toggleFault: (kind: FaultKind, targetId: string, magnitude?: number) => void;
  removeFault: (id: string) => void;
  clearFaults: () => void;

  setMode: (mode: LoadMode) => void;
  setScenarioKind: (kind: ScenarioKind) => void;
  setTargetRps: (rps: number) => void;
  setUsers: (n: number) => void;
  setThinkTime: (sec: number) => void;
  setDuration: (sec: number) => void;
  setPeakFactor: (f: number) => void;
  setSeed: (seed: number) => void;
  setSpeed: (speed: number) => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  loadSim: (sim: SimConfig) => void;
}

export const useSimStore = create<SimState>((set) => ({
  scenario: DEFAULT_SCENARIO,
  seed: 1,
  speed: 4,
  running: false,
  clock: 0,
  faults: [],

  toggleFault: (kind, targetId, magnitude) =>
    set((s) => {
      const id = faultId(kind, targetId);
      const exists = s.faults.some((f) => f.id === id);
      return {
        faults: exists
          ? s.faults.filter((f) => f.id !== id)
          : [...s.faults, { id, kind, targetId, magnitude }],
      };
    }),
  removeFault: (id) => set((s) => ({ faults: s.faults.filter((f) => f.id !== id) })),
  clearFaults: () => set({ faults: [] }),

  setMode: (mode) =>
    set((s) => {
      const sc = s.scenario;
      const z = sc.thinkTimeSec || 1;
      const n = sc.users || 0;
      // carry the load level across the switch so it doesn't jump
      const next =
        mode === 'users'
          ? { ...sc, mode, users: Math.max(1, Math.round(sc.targetRps * z)) }
          : { ...sc, mode, targetRps: Math.max(1, Math.round(n / z)) };
      return { scenario: next };
    }),
  setScenarioKind: (kind) => set((s) => ({ scenario: { ...s.scenario, kind } })),
  setTargetRps: (targetRps) =>
    set((s) => ({ scenario: { ...s.scenario, targetRps: Math.max(0, targetRps) } })),
  setUsers: (users) => set((s) => ({ scenario: { ...s.scenario, users: Math.max(0, Math.round(users)) } })),
  setThinkTime: (thinkTimeSec) =>
    set((s) => ({ scenario: { ...s.scenario, thinkTimeSec: Math.max(0.05, thinkTimeSec) } })),
  setDuration: (durationSec) =>
    set((s) => ({ scenario: { ...s.scenario, durationSec: Math.max(1, durationSec) } })),
  setPeakFactor: (peakFactor) =>
    set((s) => ({ scenario: { ...s.scenario, peakFactor: Math.max(1, peakFactor) } })),
  setSeed: (seed) => set({ seed: seed >>> 0 }),
  setSpeed: (speed) => set({ speed: Math.max(0.25, speed) }),
  play: () => set({ running: true }),
  pause: () => set({ running: false }),
  reset: () => set({ running: false, clock: 0 }),
  loadSim: (sim) =>
    set({ ...sim, scenario: { ...DEFAULT_SCENARIO, ...sim.scenario }, running: false, clock: 0, faults: [] }),
}));
