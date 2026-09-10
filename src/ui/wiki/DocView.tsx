import type { ReactNode } from 'react';
import { getModel, type ComponentType } from '@/engine';
import { ComponentIcon } from '@/flow/icons';
import { getComponentDoc, getConceptDoc } from '@/wiki';
import type { ComponentDoc, ConceptDoc, Link } from '@/wiki';
import { InlineText } from './InlineText';

/** `#component/x` / `#concept/y` — either handled in-app (wiki page) or as a link
 *  to the standalone wiki (Inspector tab). */
export type NavFn = (hash: string) => void;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--tm-text-faint)]">
        {title}
      </h3>
      <div className="text-[12.5px] leading-relaxed text-[var(--tm-text-dim)]">{children}</div>
    </section>
  );
}

const CHIP_CLS =
  'flex items-center gap-1 rounded bg-[var(--tm-chip)] px-1.5 py-0.5 text-[11px] text-[var(--tm-text-dim)] no-underline hover:bg-[var(--tm-chip-active)] hover:text-[var(--tm-text)]';

function Further({ links }: { links: Link[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {links.map((l) => (
        <li key={l.url}>
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-[var(--tm-accent-soft)] hover:underline"
          >
            {l.label} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Always a real href (works with middle-click / keyboard); when `nav` is set,
 *  the click is intercepted for in-page SPA navigation. */
function linkProps(hash: string, nav?: NavFn) {
  return {
    href: `../wiki/#${hash}`,
    onClick: nav
      ? (e: { preventDefault: () => void }) => {
          e.preventDefault();
          nav(`#${hash}`);
        }
      : undefined,
  };
}

export function ComponentDocView({
  type,
  nav,
  dense,
}: {
  type: ComponentType;
  /** When set, chips navigate in-app instead of linking to `/wiki/`. */
  nav?: NavFn;
  /** Tighter layout for the Node details sub-tab. */
  dense?: boolean;
}) {
  const doc: ComponentDoc | undefined = getComponentDoc(type);
  if (!doc) {
    return (
      <div className="p-4 text-[12px] text-[var(--tm-text-faint)]">
        No concept notes for this component yet.
      </div>
    );
  }
  const model = getModel(type);

  return (
    <div className={dense ? 'p-3' : 'p-1'}>
      <div className="flex items-center gap-2">
        <span className="text-[var(--tm-accent-soft)]">
          <ComponentIcon type={type} size={dense ? 16 : 20} />
        </span>
        <h2 className={dense ? 'text-[14px] font-semibold' : 'text-[17px] font-semibold'}>
          {model.label}
        </h2>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--tm-text)]">{doc.tagline}</p>

      {dense && nav === undefined && (
        <a
          href={`../wiki/#component/${type}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-[11px] text-[var(--tm-accent-soft)] hover:underline"
        >
          Open full page ↗
        </a>
      )}

      <Section title="The problem it solves">
        <InlineText text={doc.problem} />
      </Section>
      <Section title="How it works">
        <InlineText text={doc.mechanism} />
      </Section>
      <Section title="When to use it — and the alternative">
        <InlineText text={doc.whenToUse} />
      </Section>
      <Section title="Failure modes & behaviour under load">
        <InlineText text={doc.failure} />
      </Section>
      <Section title="What to watch">
        <ul className="ml-3.5 list-disc space-y-0.5">
          {doc.metrics.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </Section>
      <Section title="Capacity intuition">
        <InlineText text={doc.capacity} />
      </Section>
      <Section title="Best paired with">
        <div className="flex flex-col gap-1.5">
          {doc.pairedWith.map((p) => {
            const partner = getModel(p.type);
            return (
              <div key={p.type} className="flex gap-2">
                <a
                  {...linkProps(`component/${p.type}`, nav)}
                  className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-[var(--tm-text)] no-underline hover:text-[var(--tm-accent-soft)]"
                >
                  <ComponentIcon type={p.type} size={12} />
                  {partner.label}
                </a>
                <span className="text-[12px]">— {p.why}</span>
              </div>
            );
          })}
        </div>
      </Section>
      <Section title="Common mistakes">
        <ul className="ml-3.5 list-disc space-y-1">
          {doc.mistakes.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </Section>
      {doc.concepts.length > 0 && (
        <Section title="Related concepts">
          <div className="flex flex-wrap gap-1.5">
            {doc.concepts.map((slug) => {
              const c = getConceptDoc(slug);
              return (
                <a key={slug} {...linkProps(`concept/${slug}`, nav)} className={CHIP_CLS}>
                  {c?.title ?? slug}
                </a>
              );
            })}
          </div>
        </Section>
      )}
      <Section title="Further reading">
        <Further links={doc.further} />
      </Section>
    </div>
  );
}

export function ConceptDocView({ slug, nav }: { slug: string; nav?: NavFn }) {
  const doc: ConceptDoc | undefined = getConceptDoc(slug);
  if (!doc) {
    return <div className="p-4 text-[12px] text-[var(--tm-text-faint)]">Unknown concept.</div>;
  }
  return (
    <div className="p-1">
      <h2 className="text-[17px] font-semibold">{doc.title}</h2>
      <Section title="What it is">
        <InlineText text={doc.body} />
      </Section>
      <Section title="Use it when">
        <InlineText text={doc.useWhen} />
      </Section>
      {doc.relatedComponents.length > 0 && (
        <Section title="Where it shows up">
          <div className="flex flex-wrap gap-1.5">
            {doc.relatedComponents.map((t) => {
              const m = getModel(t);
              return (
                <a key={t} {...linkProps(`component/${t}`, nav)} className={CHIP_CLS}>
                  <ComponentIcon type={t} size={12} />
                  {m.label}
                </a>
              );
            })}
          </div>
        </Section>
      )}
      <Section title="Further reading">
        <Further links={doc.further} />
      </Section>
    </div>
  );
}
