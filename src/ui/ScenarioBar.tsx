import type { ScenarioKind } from '@/engine';
import { useSimStore } from '@/store/simStore';
import { useViewStore } from '@/store/viewStore';
import { fmtRps } from '@/lib/format';
import { randomScenario } from '@/lib/randomDesign';
import { HelpTip } from './HelpTip';

const TIP = {
  mode: 'RPS: a fixed request rate arrives no matter how slow the system gets (open loop). Users: a fixed population each sends a request, waits for the reply, thinks, then repeats — the effective rate self-limits as the system slows (closed loop).',
  think: 'Seconds a user waits after a reply before the next request. Effective rate ≈ users ÷ (response time + think time).',
  scenario:
    'How offered load varies over the run. Constant: flat. Ramp: climbs to the peak. Diurnal: one sine wave. Spike: a short burst mid-run. Herd: a sudden jump that decays (thundering herd).',
  peak: 'Multiplier at the busiest point of ramp / diurnal / spike / herd. 8× means peak load is eight times the baseline.',
  duration: 'Length of the simulated run in seconds — the scenario shape plays out over this window.',
  speed: 'Simulated seconds per real second while playing. Higher just fast-forwards; the result is the same.',
  seed: 'Random seed for the simulation. Same seed + design + scenario ⇒ the identical run every time.',
};

const SCENARIOS: { kind: ScenarioKind; label: string }[] = [
  { kind: 'constant', label: 'Constant' },
  { kind: 'wander', label: 'Wander' },
  { kind: 'ramp', label: 'Ramp' },
  { kind: 'diurnal', label: 'Diurnal' },
  { kind: 'spike', label: 'Spike' },
  { kind: 'thunderingHerd', label: 'Herd' },
];

const RPS_PRESETS = [100, 1_000, 10_000, 50_000];
const USER_PRESETS = [100, 1_000, 10_000, 100_000];

export function ScenarioBar() {
  const scenario = useSimStore((s) => s.scenario);
  const setMode = useSimStore((s) => s.setMode);
  const setScenarioKind = useSimStore((s) => s.setScenarioKind);
  const setPeakFactor = useSimStore((s) => s.setPeakFactor);
  const setDuration = useSimStore((s) => s.setDuration);
  const setTargetRps = useSimStore((s) => s.setTargetRps);
  const setUsers = useSimStore((s) => s.setUsers);
  const setThinkTime = useSimStore((s) => s.setThinkTime);
  const seed = useSimStore((s) => s.seed);
  const setSeed = useSimStore((s) => s.setSeed);
  const speed = useSimStore((s) => s.speed);
  const setSpeed = useSimStore((s) => s.setSpeed);
  const loadSim = useSimStore((s) => s.loadSim);
  const system = useViewStore((s) => s.system);

  const showPeak = scenario.kind !== 'constant';
  const usersMode = scenario.mode === 'users';
  const users = scenario.users ?? 0;
  const thinkTime = scenario.thinkTimeSec ?? 1;
  const effectiveRps = system.offeredRps || users / thinkTime;

  return (
    <div className="tabnum flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--tm-border)] bg-[var(--tm-panel-2)] px-4 py-1.5 text-[11px] text-[var(--tm-text-dim)]">
      <button
        onClick={() => loadSim(randomScenario())}
        className="shrink-0 rounded border border-[var(--tm-border-2)] bg-[var(--tm-chip)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--tm-btn-hover)]"
        title="Randomise the scenario (load, shape, peak, duration, speed, seed) — keeps the current design"
      >
        🎲
      </button>
      <HelpTip text={TIP.mode}>
        <span className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">load</span>
      </HelpTip>
      <div className="flex shrink-0 overflow-hidden rounded border border-[var(--tm-border)]">
        {(['rps', 'users'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="px-2 py-0.5"
            style={{
              background: scenario.mode === m ? 'var(--tm-chip-active)' : 'var(--tm-panel-2)',
              color: scenario.mode === m ? 'var(--tm-accent-soft)' : 'var(--tm-text-dim)',
            }}
          >
            {m === 'rps' ? 'RPS' : 'Users'}
          </button>
        ))}
      </div>

      {usersMode ? (
        <>
          <input
            type="range"
            min={1}
            max={100000}
            step={1}
            value={users}
            onChange={(e) => setUsers(Number(e.target.value))}
            className="w-28 shrink-0 accent-[var(--tm-accent)]"
          />
          <span className="w-20 shrink-0 text-right text-[var(--tm-text)]">
            {users.toLocaleString()} users
          </span>
          <div className="flex shrink-0 gap-1">
            {USER_PRESETS.map((n) => (
              <button
                key={n}
                onClick={() => setUsers(n)}
                className="rounded px-1.5 py-0.5"
                style={{
                  background: users === n ? 'var(--tm-chip-active)' : 'var(--tm-chip)',
                  color: users === n ? 'var(--tm-accent-soft)' : 'var(--tm-text-dim)',
                }}
              >
                {n >= 1000 ? `${n / 1000}k` : n}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-1.5">
            <HelpTip text={TIP.think}>think</HelpTip>
            <input
              type="number"
              min={0.05}
              max={60}
              step={0.05}
              value={thinkTime}
              onChange={(e) => setThinkTime(Number(e.target.value))}
              className="w-14 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-1 py-0.5 text-right text-[var(--tm-text)] outline-none"
            />
            s
          </label>
          <span className="shrink-0 text-[var(--tm-text-faint)]">≈ {fmtRps(effectiveRps)}</span>
        </>
      ) : (
        <>
          <input
            type="range"
            min={10}
            max={50000}
            step={10}
            value={scenario.targetRps}
            onChange={(e) => setTargetRps(Number(e.target.value))}
            className="w-28 shrink-0 accent-[var(--tm-accent)]"
          />
          <span className="w-14 shrink-0 text-right text-[var(--tm-text)]">{fmtRps(scenario.targetRps)}</span>
          <div className="flex shrink-0 gap-1">
            {RPS_PRESETS.map((rps) => (
              <button
                key={rps}
                onClick={() => setTargetRps(rps)}
                className="rounded px-1.5 py-0.5"
                style={{
                  background: scenario.targetRps === rps ? 'var(--tm-chip-active)' : 'var(--tm-chip)',
                  color: scenario.targetRps === rps ? 'var(--tm-accent-soft)' : 'var(--tm-text-dim)',
                }}
              >
                {fmtRps(rps).replace('/s', '')}
              </button>
            ))}
          </div>
        </>
      )}

      <span className="ml-2 shrink-0 border-l border-[var(--tm-border)] pl-3 text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
        <HelpTip text={TIP.scenario}>scenario</HelpTip>
      </span>
      <div className="flex shrink-0 gap-1">
        {SCENARIOS.map((s) => (
          <button
            key={s.kind}
            onClick={() => setScenarioKind(s.kind)}
            className="rounded px-2 py-0.5"
            style={{
              background: scenario.kind === s.kind ? 'var(--tm-chip-active)' : 'var(--tm-chip)',
              color: scenario.kind === s.kind ? 'var(--tm-accent-soft)' : 'var(--tm-text-dim)',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {showPeak && (
        <label className="flex shrink-0 items-center gap-1.5">
          <HelpTip text={TIP.peak}>peak ×</HelpTip>
          <input
            type="range"
            min={1}
            max={30}
            step={0.5}
            value={scenario.peakFactor ?? 8}
            onChange={(e) => setPeakFactor(Number(e.target.value))}
            className="w-24 accent-[var(--tm-accent)]"
          />
          <span className="w-7 text-[var(--tm-text)]">{(scenario.peakFactor ?? 8).toFixed(1)}</span>
        </label>
      )}

      <label className="flex shrink-0 items-center gap-1.5">
        <HelpTip text={TIP.duration}>duration</HelpTip>
        <input
          type="number"
          min={10}
          max={3600}
          value={scenario.durationSec}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="w-16 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-1 py-0.5 text-right text-[var(--tm-text)] outline-none"
        />
        s
      </label>

      <label className="flex shrink-0 items-center gap-1.5">
        <HelpTip text={TIP.speed}>speed ×</HelpTip>
        <input
          type="range"
          min={0.5}
          max={32}
          step={0.5}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="w-24 accent-[var(--tm-accent)]"
        />
        <span className="w-7 text-[var(--tm-text)]">{speed.toFixed(1)}</span>
      </label>

      <label className="flex shrink-0 items-center gap-1.5">
        <HelpTip text={TIP.seed}>seed</HelpTip>
        <input
          type="number"
          min={0}
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value))}
          className="w-16 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-1 py-0.5 text-right text-[var(--tm-text)] outline-none"
        />
      </label>
    </div>
  );
}
