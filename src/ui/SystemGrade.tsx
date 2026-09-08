import type { Capacity } from '@/engine';
import { useViewStore } from '@/store/viewStore';
import { HelpTip } from './HelpTip';

const GRADE_COLOR: Record<Capacity['grade'], string> = {
  A: 'var(--tm-good-fg)',
  B: 'var(--tm-good-fg)',
  C: 'var(--tm-warn-fg)',
  D: '#f0883e',
  F: 'var(--tm-crit-fg)',
  '—': 'var(--tm-text-faint)',
};

/** Compact headline pill: the current design's grade + how much room it has to
 *  grow before the busiest component saturates. Lives in the metrics drawer. */
export function SystemGrade() {
  const cap = useViewStore((s) => s.analysis?.capacity);
  if (!cap || cap.grade === '—') return null;

  const color = GRADE_COLOR[cap.grade];
  const headroom =
    cap.headroom >= 50 ? '50×+' : cap.headroom < 1 ? `${cap.headroom.toFixed(2)}×` : `${cap.headroom.toFixed(1)}×`;

  return (
    <HelpTip text={cap.note} align="left">
      <span className="flex items-center gap-1.5">
        <span
          className="grid h-4 w-4 place-items-center rounded text-[10px] font-bold"
          style={{ background: `${color}22`, color }}
        >
          {cap.grade}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
          grade
        </span>
        <span className="tabnum text-[var(--tm-text-dim)]">{headroom} headroom</span>
      </span>
    </HelpTip>
  );
}
