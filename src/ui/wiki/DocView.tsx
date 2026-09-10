import type { ReactNode } from 'react';
import { getModel, type ComponentType } from '@/engine';
import { ComponentIcon } from '@/flow/icons';
import { CLUSTER_LABEL, getComponentDoc, getConceptDoc } from '@/wiki';
import type { ComponentDoc, ConceptDoc, Link } from '@/wiki';
import { InlineText } from './InlineText';

/** `#component/x` / `#concept/y` — handled in-app on the wiki page, or a link to
 *  the standalone wiki everywhere else. */
export type NavFn = (hash: string) => void;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 border-t border-[var(--tm-border)] pt-3 first:mt-0 first:border-0 first:pt-0">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--tm-text-faint)]">
        {title}
      </h3>
      <div className="text-[12.5px] leading-relaxed text-[var(--tm-text-dim)]">{children}</div>
    </section>
  );
}

const CHIP_CLS =
  'flex items-center gap-1 rounded bg-[var(--tm-chip)] px-1.5 py-0.5 text-[11px] text-[var(--tm-text-dim)] no-underline hover:bg-[var(--tm-chip-active)] hover:text-[var(--tm-text)]';

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((it) => (
        <li key={it} className="flex gap-1.5">
          <span className="mt-[3px] text-[var(--tm-text-faint)]">•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

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

/** Always a real href (middle-click / keyboard work); with `nav`, the click is
 *  intercepted for in-page navigation on the wiki. */
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

export function ComponentDocView({ type, nav }: { type: ComponentType; nav?: NavFn }) {
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
    <div>
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="text-[var(--tm-accent-soft)]">
          <ComponentIcon type={type} size={20} />
        </span>
        <h2 className="text-[16px] font-semibold text-[var(--tm-text)]">{model.label}</h2>
        <span className="rounded bg-[var(--tm-chip)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--tm-text-faint)]">
          {CLUSTER_LABEL[doc.cluster]}
        </span>
      </div>
      <p
        className="mt-2 border-l-2 border-[var(--tm-accent-border)] pl-2.5 text-[12.5px] leading-relaxed text-[var(--tm-text)]"
      >
        {doc.tagline}
      </p>

      <div className="mt-3">
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
          <Bullets items={doc.metrics} />
        </Section>
        <Section title="Capacity intuition">
          <InlineText text={doc.capacity} />
        </Section>
        <Section title="Best paired with">
          <div className="flex flex-col gap-1.5">
            {doc.pairedWith.map((p) => {
              const partner = getModel(p.type);
              return (
                <div
                  key={p.type}
                  className="rounded border border-[var(--tm-border)] bg-[var(--tm-panel-2)] px-2 py-1.5"
                >
                  <a
                    {...linkProps(`component/${p.type}`, nav)}
                    className="flex items-center gap-1 text-[12px] font-medium text-[var(--tm-text)] no-underline hover:text-[var(--tm-accent-soft)]"
                  >
                    <ComponentIcon type={p.type} size={12} />
                    {partner.label}
                  </a>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--tm-text-dim)]">{p.why}</p>
                </div>
              );
            })}
          </div>
        </Section>
        <Section title="Common mistakes">
          <Bullets items={doc.mistakes} />
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
    </div>
  );
}

export function ConceptDocView({ slug, nav }: { slug: string; nav?: NavFn }) {
  const doc: ConceptDoc | undefined = getConceptDoc(slug);
  if (!doc) {
    return <div className="p-4 text-[12px] text-[var(--tm-text-faint)]">Unknown concept.</div>;
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="w-[20px] text-center text-[var(--tm-text-faint)]">§</span>
        <h2 className="text-[16px] font-semibold text-[var(--tm-text)]">{doc.title}</h2>
        <span className="rounded bg-[var(--tm-chip)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--tm-text-faint)]">
          {CLUSTER_LABEL[doc.cluster]}
        </span>
      </div>
      <div className="mt-3">
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
    </div>
  );
}
