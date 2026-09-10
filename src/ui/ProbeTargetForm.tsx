import { useEffect, useMemo, useState } from 'react';
import { useProbeStore, emptyTarget } from '@/store/probeStore';
import { isAllowedTarget } from '@/live/targetPolicy';
import { looksLikeCurl, parseCurl } from '@/live/curl';
import type { ProbeTarget } from '@/live/probeProtocol';

const METHODS: ProbeTarget['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const CORS_SNIPPETS: [string, string][] = [
  ['Express', "app.use(require('cors')());"],
  ['FastAPI', 'app.add_middleware(CORSMiddleware, allow_origins=["*"])'],
  ['Go (net/http)', 'w.Header().Set("Access-Control-Allow-Origin", "*")'],
  ['Rails', 'Rack::Cors — allow origins "*", resource "*"'],
];

/**
 * Editor for a node's Live Probe endpoint. Bound straight to `probeStore` —
 * these fields (URL / headers / body) are intentionally NOT part of the design
 * document, so they never touch localStorage, share URLs or exports.
 */
export function ProbeTargetForm({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const stored = useProbeStore((s) => s.targets[nodeId]);
  const setTarget = useProbeStore((s) => s.setTarget);
  const clearTarget = useProbeStore((s) => s.clearTarget);

  const [draft, setDraft] = useState<ProbeTarget>(() => stored ?? emptyTarget());
  const [testState, setTestState] = useState<string | null>(null);
  const [showCors, setShowCors] = useState(false);
  const [pastedCurl, setPastedCurl] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const check = useMemo(() => (draft.url.trim() ? isAllowedTarget(draft.url) : null), [draft.url]);

  const patch = (p: Partial<ProbeTarget>) => setDraft((d) => ({ ...d, ...p }));

  /** Paste a whole `curl …` command into the URL box → fill every field. */
  const onUrlChange = (raw: string) => {
    if (looksLikeCurl(raw)) {
      const parsed = parseCurl(raw);
      if (parsed) {
        setDraft((d) => ({
          ...d,
          method: parsed.method ?? d.method,
          url: parsed.url ?? d.url,
          headers: parsed.headers?.length ? parsed.headers : d.headers,
          body: parsed.body ?? d.body,
        }));
        setPastedCurl(true);
        return;
      }
    }
    setPastedCurl(false);
    patch({ url: raw });
  };
  const setHeader = (i: number, kv: [string, string]) =>
    setDraft((d) => ({ ...d, headers: d.headers.map((h, j) => (j === i ? kv : h)) }));
  const addHeader = () => setDraft((d) => ({ ...d, headers: [...d.headers, ['', '']] }));
  const rmHeader = (i: number) =>
    setDraft((d) => ({ ...d, headers: d.headers.filter((_, j) => j !== i) }));

  const save = () => {
    setTarget(nodeId, {
      ...draft,
      headers: draft.headers.filter(([k]) => k.trim()),
    });
    onClose();
  };

  const runTest = async () => {
    if (!check?.ok) return;
    setTestState('testing…');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const t0 = performance.now();
    try {
      const headers: Record<string, string> = {};
      for (const [k, v] of draft.headers) if (k.trim()) headers[k.trim()] = v;
      const res = await fetch(draft.url, {
        method: draft.method,
        headers,
        body: draft.method !== 'GET' && draft.body ? draft.body : undefined,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      const ms = Math.round(performance.now() - t0);
      setTestState(
        res.type === 'opaqueredirect'
          ? `redirect — not followed (${ms} ms)`
          : `${res.status} ${res.statusText || ''} · ${ms} ms`,
      );
    } catch {
      setTestState(`failed — is the server up and CORS-enabled? (${Math.round(performance.now() - t0)} ms)`);
    } finally {
      clearTimeout(to);
    }
  };

  const field =
    'w-full rounded border border-[var(--tm-border-2)] bg-[var(--tm-node)] px-2 py-1 text-[12px] text-[var(--tm-text)] outline-none focus:border-[var(--tm-accent)]';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[460px] max-w-full flex-col overflow-hidden rounded-lg border border-[var(--tm-border-2)] bg-[var(--tm-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--tm-border)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--tm-text)]">Live probe endpoint</span>
          <button
            onClick={onClose}
            className="ml-auto text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3 text-[12px]">
          <div className="flex gap-2">
            <select
              value={draft.method}
              onChange={(e) => patch({ method: e.target.value as ProbeTarget['method'] })}
              className={`${field} w-24 shrink-0`}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              value={draft.url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="http://localhost:3000/api/health — or paste a curl command"
              className={field}
              autoFocus
            />
          </div>
          {pastedCurl && (
            <p className="text-[10px] text-[var(--tm-good-fg)]">
              Parsed the curl command — method, headers and body filled below.
            </p>
          )}

          {check && !check.ok && (
            <p className="rounded bg-[var(--tm-crit-bg)] px-2 py-1 text-[11px] text-[var(--tm-crit-fg)]">
              {check.reason}
            </p>
          )}
          {check?.ok && check.isPublic && (
            <p className="rounded bg-[var(--tm-warn-bg)] px-2 py-1 text-[11px] text-[var(--tm-warn-fg)]">
              Public endpoint. Most public APIs block browser requests via CORS — expect network
              errors unless the API sends <code>Access-Control-Allow-Origin</code>. You'll confirm
              you're allowed to load-test it before the first run.
            </p>
          )}
          {check?.ok && check.mixedContentWarning && (
            <p className="rounded bg-[var(--tm-warn-bg)] px-2 py-1 text-[11px] text-[var(--tm-warn-fg)]">
              This page is served over HTTPS — the browser may block an <code>http://</code> target.
              Run <code>npm run dev</code> locally for the smoothest path.
            </p>
          )}

          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--tm-text-faint)]">
              <span>Headers</span>
              <button onClick={addHeader} className="text-[var(--tm-accent)] hover:underline">
                + add
              </button>
              <button
                onClick={() => setShowCors((v) => !v)}
                className="ml-auto text-[var(--tm-text-faint)] hover:text-[var(--tm-text)]"
                title="CORS help"
              >
                ? CORS
              </button>
            </div>
            {showCors && (
              <div className="mb-2 rounded border border-[var(--tm-border)] bg-[var(--tm-node)] p-2 text-[10px] text-[var(--tm-text-dim)]">
                <p className="mb-1">
                  Your dev server must allow this origin. A non-GET or custom-header request also
                  triggers an <code>OPTIONS</code> preflight.
                </p>
                {CORS_SNIPPETS.map(([fw, code]) => (
                  <div key={fw} className="tabnum">
                    <span className="text-[var(--tm-text-faint)]">{fw}:</span> <code>{code}</code>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1">
              {draft.headers.map((h, i) => (
                <div key={i} className="flex gap-1">
                  <input
                    value={h[0]}
                    onChange={(e) => setHeader(i, [e.target.value, h[1]])}
                    placeholder="Header"
                    className={`${field} flex-[2]`}
                  />
                  <input
                    value={h[1]}
                    onChange={(e) => setHeader(i, [h[0], e.target.value])}
                    placeholder="value"
                    className={`${field} flex-[3]`}
                  />
                  <button
                    onClick={() => rmHeader(i)}
                    className="shrink-0 px-1 text-[var(--tm-text-faint)] hover:text-[var(--tm-crit-fg)]"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {draft.method !== 'GET' && (
            <div>
              <div className="mb-1 text-[11px] text-[var(--tm-text-faint)]">Body</div>
              <textarea
                value={draft.body}
                onChange={(e) => patch({ body: e.target.value })}
                rows={3}
                placeholder='{"key":"value"}'
                className={`${field} resize-y font-mono`}
              />
            </div>
          )}

          <p className="text-[10px] text-[var(--tm-text-faint)]">
            Not saved with the design — cleared on reload. Browser-generated load is reliable to a
            few hundred req/s; timings are indicative.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--tm-border)] px-4 py-3">
          <button
            onClick={runTest}
            disabled={!check?.ok}
            className="rounded border border-[var(--tm-border-2)] bg-[var(--tm-btn)] px-2.5 py-1 text-[12px] text-[var(--tm-text)] hover:bg-[var(--tm-btn-hover)] disabled:opacity-40"
          >
            Test
          </button>
          {testState && (
            <span className="tabnum text-[11px] text-[var(--tm-text-dim)]">{testState}</span>
          )}
          {stored && (
            <button
              onClick={() => {
                clearTarget(nodeId);
                onClose();
              }}
              className="text-[11px] text-[var(--tm-text-faint)] hover:text-[var(--tm-crit-fg)]"
            >
              Remove
            </button>
          )}
          <button
            onClick={save}
            disabled={!check?.ok}
            className="ml-auto rounded bg-[var(--tm-accent)] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
