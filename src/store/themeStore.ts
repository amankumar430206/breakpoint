import { create } from 'zustand';
import {
  applyTheme,
  getPref,
  resolveTheme,
  setPref,
  systemTheme,
  type Theme,
  type ThemePref,
} from '@/lib/theme';

interface ThemeState {
  /** User preference: explicit theme or 'system'. */
  pref: ThemePref;
  /** Concrete theme currently applied. */
  theme: Theme;
  setPref: (pref: ThemePref) => void;
  /** Cycle system → dark → light → system. */
  cycle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  pref: getPref(),
  theme: resolveTheme(),
  setPref: (pref) => {
    setPref(pref);
    set({ pref, theme: resolveTheme(pref) });
  },
  cycle: () => {
    const order: ThemePref[] = ['system', 'dark', 'light'];
    const next = order[(order.indexOf(get().pref) + 1) % order.length];
    get().setPref(next);
  },
}));

// Follow the OS while the user hasn't picked an explicit theme.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (useThemeStore.getState().pref === 'system') {
      const t = systemTheme();
      applyTheme(t);
      useThemeStore.setState({ theme: t });
    }
  });
}
