import { useRef, useState } from 'react';
import type { SystemDesign } from '@/engine';
import { useDesignStore } from '@/store/designStore';
import { useSimStore } from '@/store/simStore';
import { useViewStore } from '@/store/viewStore';
import { toDesign } from '@/lib/design';
import { serializeDesign, parseDesignJson } from '@/lib/serialize';
import { shareUrl } from '@/lib/shareUrl';
import { buildReport } from '@/lib/report';
import { downloadText, slugify } from '@/lib/download';
import { exportCanvasPng, exportCanvasSvg } from '@/lib/exportImage';

export function ShareMenu({
  title,
  onImport,
}: {
  title: string;
  onImport: (d: SystemDesign) => void;
}) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const currentDesign = (): SystemDesign => {
    const { nodes, edges } = useDesignStore.getState();
    const { scenario, seed, speed } = useSimStore.getState();
    return toDesign(nodes, edges, { scenario, seed, speed }, { name: title });
  };

  const say = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 1800);
  };

  const close = () => setOpen(false);
  const act = (fn: () => void | Promise<void>) => async () => {
    await fn();
    close();
  };

  const copyLink = act(async () => {
    const url = shareUrl(currentDesign());
    try {
      await navigator.clipboard.writeText(url);
      say('Share link copied');
    } catch {
      say('Copy failed — link is in the address bar');
      location.hash = new URL(url).hash;
    }
  });

  const downloadJson = act(() => {
    const d = currentDesign();
    downloadText(`${slugify(d.name)}.json`, serializeDesign(d), 'application/json');
  });

  const downloadReport = act(() => {
    const d = currentDesign();
    const { analysis } = useViewStore.getState();
    // rebuild an analytical result for the report
    import('@/engine').then(({ solve, analyze }) => {
      const r = solve(d);
      downloadText(`${slugify(d.name)}-report.md`, buildReport(d, r, analysis ?? analyze(d, r)), 'text/markdown');
    });
  });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      const res = parseDesignJson(text);
      if (res.ok) {
        onImport(res.design);
        say(res.warnings.length ? `Imported (${res.warnings.length} warning)` : 'Imported');
      } else {
        say(`Import failed: ${res.error}`);
      }
      close();
    });
  };

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-2 py-1 text-xs text-[var(--tm-text-dim)] hover:bg-[var(--tm-btn-hover)]"
      >
        Share / Export ▾
      </button>
      {flash && (
        <div className="absolute right-0 top-full mt-1 whitespace-nowrap rounded bg-[var(--tm-good-bg)] px-2 py-1 text-[10px] text-[var(--tm-good-fg)]">
          {flash}
        </div>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[190px] overflow-hidden rounded-md border border-[var(--tm-border-2)] bg-[var(--tm-panel)] py-1 text-xs shadow-xl">
            <MenuItem onClick={copyLink}>Copy share link</MenuItem>
            <MenuItem onClick={downloadJson}>Download JSON</MenuItem>
            <MenuItem onClick={() => fileRef.current?.click()}>Import JSON…</MenuItem>
            <div className="my-1 border-t border-[var(--tm-border)]" />
            <MenuItem onClick={act(() => exportCanvasPng(`${slugify(title)}.png`))}>
              Download PNG
            </MenuItem>
            <MenuItem onClick={act(() => exportCanvasSvg(`${slugify(title)}.svg`))}>
              Download SVG
            </MenuItem>
            <MenuItem onClick={downloadReport}>Download report (.md)</MenuItem>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)]"
    >
      {children}
    </button>
  );
}
