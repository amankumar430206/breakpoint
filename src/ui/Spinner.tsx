/** Tiny indeterminate spinner — used wherever the compute worker is busy. */
export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className="inline-block shrink-0 animate-spin rounded-full border-2 border-[var(--tm-border-2)] border-t-[var(--tm-accent)]"
      style={{ width: size, height: size }}
    />
  );
}
