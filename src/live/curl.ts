import type { ProbeTarget } from './probeProtocol';

/**
 * Best-effort parser for a pasted `curl` command → probe target fields. Handles
 * the flags people actually paste from browser devtools / API docs:
 * `-X/--request`, `-H/--header`, `-d/--data[-raw|-binary|-urlencode]`,
 * `-u/--user` (→ Basic auth), `--url`, and the bare URL argument. Cosmetic
 * flags (`-s -i -L -k --compressed …`) are ignored.
 */

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Shell-ish tokenizer: splits on whitespace but keeps '…' and "…" groups. */
function tokenize(input: string): string[] {
  const s = input.replace(/\\\r?\n/g, ' '); // line continuations
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else buf += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
      continue;
    }
    if (c === '\\' && i + 1 < s.length) {
      buf += s[++i];
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (has) out.push(buf);
      buf = '';
      has = false;
      continue;
    }
    buf += c;
    has = true;
  }
  if (has) out.push(buf);
  return out;
}

function b64(s: string): string {
  if (typeof btoa === 'function') return btoa(s);
  // node / worker fallback
  return Buffer.from(s, 'utf-8').toString('base64');
}

export function looksLikeCurl(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text);
}

export function parseCurl(command: string): Partial<ProbeTarget> | null {
  if (!looksLikeCurl(command)) return null;
  const tok = tokenize(command.trim());
  if (!tok.length) return null;
  tok.shift(); // drop "curl"

  const out: Partial<ProbeTarget> = {};
  const headers: [string, string][] = [];
  let method: ProbeTarget['method'] | null = null;
  let url = '';
  const bodyParts: string[] = [];

  const val = (i: number) => tok[i + 1] ?? '';

  for (let i = 0; i < tok.length; i++) {
    const a = tok[i];
    if (a === '-X' || a === '--request') {
      const m = val(i).toUpperCase();
      if (METHODS.has(m)) method = m as ProbeTarget['method'];
      i++;
    } else if (a === '-H' || a === '--header') {
      const raw = val(i);
      const idx = raw.indexOf(':');
      if (idx > 0) headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
      i++;
    } else if (
      a === '-d' ||
      a === '--data' ||
      a === '--data-raw' ||
      a === '--data-binary' ||
      a === '--data-ascii' ||
      a === '--data-urlencode'
    ) {
      bodyParts.push(val(i));
      i++;
    } else if (a === '-u' || a === '--user') {
      headers.push(['Authorization', `Basic ${b64(val(i))}`]);
      i++;
    } else if (a === '--url') {
      url = val(i);
      i++;
    } else if (a.startsWith('-')) {
      // unknown flag — skip its value only when it's a known value-taking one we
      // don't model; otherwise assume it's boolean (--compressed, -sSL, …)
      if (['-o', '-O', '-w', '-A', '-e', '--referer', '--connect-timeout', '-m', '--max-time'].includes(a)) i++;
    } else if (!url) {
      url = a;
    }
  }

  if (!url) return null;
  out.url = url;
  out.method = method ?? (bodyParts.length ? 'POST' : 'GET');
  if (headers.length) out.headers = headers;
  if (bodyParts.length) out.body = bodyParts.join('&');
  return out;
}
