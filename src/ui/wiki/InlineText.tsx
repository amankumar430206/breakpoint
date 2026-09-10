import { Fragment, type ReactNode } from 'react';

/**
 * Minimal prose renderer for the wiki. Splits a string on blank lines into
 * paragraphs, and within a paragraph renders `**bold**` and `` `code` ``. No
 * markdown dependency — the content model is fielded, not free-form documents.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  // split on `**bold**` and `` `code` `` while keeping the delimiters
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`;
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-[var(--tm-text)]">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <code
          key={key}
          className="tabnum rounded bg-[var(--tm-chip)] px-1 py-px text-[0.92em] text-[var(--tm-text)]"
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{p}</Fragment>;
  });
}

export function InlineText({ text, className }: { text: string; className?: string }) {
  const paras = text.trim().split(/\n\s*\n/);
  return (
    <div className={className}>
      {paras.map((para, i) => (
        <p key={i} className={i > 0 ? 'mt-2' : undefined}>
          {inline(para, String(i))}
        </p>
      ))}
    </div>
  );
}
