import { memo } from 'react';
import { useDesignStore } from '@/store/designStore';
import { useProbeStore } from '@/store/probeStore';

/** Floating list of nodes whose model is calibrated from a measured probe run.
 *  Transient overlay (not saved) — mirrors ChaosBar. Hidden when none. */
function CalibrationBarInner() {
  const calibration = useProbeStore((s) => s.calibration);
  const clearCalibration = useProbeStore((s) => s.clearCalibration);
  const nodes = useDesignStore((s) => s.nodes);

  const ids = Object.keys(calibration);
  if (ids.length === 0) return null;

  return (
    <div className="pointer-events-auto w-[240px] rounded-xl border border-[var(--tm-accent-border)] bg-[var(--tm-panel)]/95 shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--tm-accent-soft)]">
        <span>◎ Calibrated from measurement</span>
        <button
          onClick={() => clearCalibration()}
          className="ml-auto text-[10px] text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
        >
          reset all
        </button>
      </div>
      <div className="flex flex-col gap-1 px-3 pb-3">
        {ids.map((id) => {
          const c = calibration[id];
          const label = nodes.find((n) => n.id === id)?.data.label ?? id;
          return (
            <div
              key={id}
              className="flex items-center gap-2 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] px-2 py-1 text-[11px]"
            >
              <span className="flex-1 truncate text-[var(--tm-text)]">{label}</span>
              <span className="tabnum shrink-0 text-[10px] text-[var(--tm-text-faint)]">
                {c.serviceTimeMs != null ? `${c.serviceTimeMs.toFixed(0)}ms` : ''}
              </span>
              <button
                onClick={() => clearCalibration(id)}
                className="shrink-0 text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
                title="revert to authored params"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const CalibrationBar = memo(CalibrationBarInner);
