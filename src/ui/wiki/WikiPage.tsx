import { useCallback, useEffect, useMemo, useState } from 'react';
import { getModel } from '@/engine';
import { ComponentIcon } from '@/flow/icons';
import {
  allMistakes,
  componentDocList,
  conceptDocList,
  parseWikiHash,
  wikiGroups,
} from '@/wiki';
import { ComponentDocView, ConceptDocView } from './DocView';

type Target =
  | { kind: 'component'; slug: string }
  | { kind: 'concept'; slug: string }
  | { kind: 'pitfalls' };

function readTarget(): Target {
  return (parseWikiHash(window.location.hash) as Target | null) ?? { kind: 'pitfalls' };
}

export function WikiPage() {
  const [target, setTarget] = useState<Target>(readTarget);
  const [q, setQ] = useState('');

  useEffect(() => {
    const onHash = () => setTarget(readTarget());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const nav = useCallback((hash: string) => {
    window.location.hash = hash;
    document.getElementById('wiki-main')?.scrollTo({ top: 0 });
  }, []);

  const groups = useMemo(() => wikiGroups(), []);
  const filter = q.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!filter) return null;
    const comp = componentDocList().filter(
      (d) =>
        getModel(d.type).label.toLowerCase().includes(filter) ||
        d.tagline.toLowerCase().includes(filter) ||
        d.type.toLowerCase().includes(filter),
    );
    const con = conceptDocList().filter(
      (d) => d.title.toLowerCase().includes(filter) || d.body.toLowerCase().includes(filter),
    );
    return { comp, con };
  }, [filter]);

  const railBtn = (active: boolean) =>
    `flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] ${
      active
        ? 'bg-[var(--tm-chip-active)] text-[var(--tm-text)]'
        : 'text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn)] hover:text-[var(--tm-text)]'
    }`;

  return (
    <div className="flex h-full flex-col bg-[var(--tm-bg)] text-[var(--tm-text)]">
      {/* top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--tm-border)] bg-[var(--tm-panel)] px-4 py-2 text-sm">
        <a
          href="../sandbox/"
          className="flex items-center gap-2 font-semibold tracking-tight no-underline hover:opacity-80"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M3 9h9"
              stroke="var(--tm-accent)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M12 15h9"
              stroke="var(--tm-accent)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <circle cx="12" cy="12" r="3" fill="var(--tm-crit-fg)" />
          </svg>
          Breakpoint
        </a>
        <span className="text-[var(--tm-text-faint)]">/</span>
        <span className="text-[var(--tm-text-dim)]">System Design Wiki</span>
        <a
          href="../sandbox/"
          className="ml-auto rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-2 py-1 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn-hover)]"
        >
          Open the sandbox →
        </a>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* rail */}
        <nav className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--tm-border)] bg-[var(--tm-panel)] p-3 md:flex">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="mb-3 w-full rounded border border-[var(--tm-border-2)] bg-[var(--tm-node)] px-2 py-1 text-[12px] outline-none focus:border-[var(--tm-accent)]"
          />
          {groups.map((g) => (
            <div key={g.cluster} className="mb-3">
              <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-[var(--tm-text-faint)]">
                {g.label}
              </div>
              {g.components.map((d) => (
                <button
                  key={d.type}
                  onClick={() => nav(`#component/${d.type}`)}
                  className={railBtn(target.kind === 'component' && target.slug === d.type)}
                >
                  <ComponentIcon type={d.type} size={13} />
                  {getModel(d.type).label}
                </button>
              ))}
              {g.concepts.map((c) => (
                <button
                  key={c.slug}
                  onClick={() => nav(`#concept/${c.slug}`)}
                  className={railBtn(target.kind === 'concept' && target.slug === c.slug)}
                >
                  <span className="w-[13px] text-center text-[var(--tm-text-faint)]">§</span>
                  {c.title}
                </button>
              ))}
            </div>
          ))}
          <button
            onClick={() => nav('#pitfalls')}
            className={`mt-1 ${railBtn(target.kind === 'pitfalls')}`}
          >
            <span className="w-[13px] text-center">⚠</span>
            Common pitfalls
          </button>
        </nav>

        {/* main */}
        <main id="wiki-main" className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-6 py-8">
            {matches ? (
              <SearchResults matches={matches} nav={nav} q={q} />
            ) : target.kind === 'component' ? (
              <ComponentDocView type={target.slug as never} nav={nav} />
            ) : target.kind === 'concept' ? (
              <ConceptDocView slug={target.slug} nav={nav} />
            ) : (
              <Pitfalls nav={nav} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function SearchResults({
  matches,
  nav,
  q,
}: {
  matches: { comp: ReturnType<typeof componentDocList>; con: ReturnType<typeof conceptDocList> };
  nav: (h: string) => void;
  q: string;
}) {
  const empty = matches.comp.length === 0 && matches.con.length === 0;
  return (
    <div>
      <h2 className="text-[15px] font-semibold">Results for “{q.trim()}”</h2>
      {empty && <p className="mt-3 text-[13px] text-[var(--tm-text-faint)]">Nothing matched.</p>}
      {matches.comp.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
            Components
          </div>
          {matches.comp.map((d) => (
            <button
              key={d.type}
              onClick={() => nav(`#component/${d.type}`)}
              className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--tm-btn)]"
            >
              <span className="text-[13px] font-medium text-[var(--tm-text)]">
                {getModel(d.type).label}
              </span>
              <span className="truncate text-[11px] text-[var(--tm-text-dim)]">{d.tagline}</span>
            </button>
          ))}
        </div>
      )}
      {matches.con.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--tm-text-faint)]">
            Concepts
          </div>
          {matches.con.map((c) => (
            <button
              key={c.slug}
              onClick={() => nav(`#concept/${c.slug}`)}
              className="flex w-full rounded px-2 py-1.5 text-left text-[13px] font-medium text-[var(--tm-text)] hover:bg-[var(--tm-btn)]"
            >
              {c.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Pitfalls({ nav }: { nav: (h: string) => void }) {
  const rows = useMemo(() => allMistakes(), []);
  return (
    <div>
      <h2 className="text-[17px] font-semibold">Common pitfalls</h2>
      <p className="mt-1 text-[12.5px] text-[var(--tm-text-dim)]">
        The recurring gaps — one system-design mistake per line, grouped by the component it bites.
      </p>
      <div className="mt-4 flex flex-col gap-1">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 border-b border-[var(--tm-border)] py-1.5 last:border-0">
            <button
              onClick={() => nav(`#component/${r.type}`)}
              className="w-32 shrink-0 text-left text-[11px] font-medium text-[var(--tm-accent-soft)] hover:underline"
            >
              {r.label}
            </button>
            <span className="text-[12.5px] text-[var(--tm-text-dim)]">{r.mistake}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
