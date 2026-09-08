import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const WIDTH = 240;

/**
 * A label with a hover/focus popover explaining what a control or metric means.
 * The popover renders in a portal with fixed positioning so it is never clipped
 * by a scrolling toolbar.
 */
export function HelpTip({
  children,
  text,
  align = 'left',
}: {
  children: ReactNode;
  text: ReactNode;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left =
      align === 'right'
        ? Math.max(8, r.right - WIDTH)
        : Math.min(window.innerWidth - WIDTH - 8, r.left);
    setPos({ top: r.bottom + 6, left });
  };
  const close = () => setPos(null);

  return (
    <span
      ref={ref}
      className="relative inline-flex cursor-help items-center gap-0.5"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      tabIndex={0}
    >
      {children}
      <span className="grid h-3 w-3 place-items-center rounded-full border border-[var(--tm-border-2)] text-[7px] font-bold text-[var(--tm-text-faint)]">
        i
      </span>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            className="fixed z-[100] rounded-md border border-[var(--tm-border-2)] bg-[var(--tm-panel)] p-2 text-[11px] font-normal leading-relaxed text-[var(--tm-text-dim)] shadow-xl"
            style={{ top: pos.top, left: pos.left, width: WIDTH }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
