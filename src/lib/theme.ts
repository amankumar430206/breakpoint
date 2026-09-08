export type Theme = 'dark' | 'light';
/** What the user chose: an explicit theme, or 'system' to follow the OS. */
export type ThemePref = Theme | 'system';

const KEY = 'tm-theme';

export function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The stored preference, or 'system' when nothing has been chosen. */
export function getPref(): ThemePref {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    /* private mode / blocked storage */
  }
  return 'system';
}

/** The concrete theme to render right now. */
export function resolveTheme(pref: ThemePref = getPref()): Theme {
  return pref === 'system' ? systemTheme() : pref;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

export function setPref(pref: ThemePref): void {
  applyTheme(resolveTheme(pref));
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
}
