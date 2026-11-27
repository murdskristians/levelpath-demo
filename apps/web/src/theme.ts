export type Theme = 'light' | 'dark';
export const THEME_KEY = 'levelpath.theme';

export function systemTheme(): Theme {
  const dark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

/** The stored choice, or null when none or invalid. A storage failure is logged. */
export function loadTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch (err) {
    console.warn('levelpath: could not read the stored theme', err);
    return null;
  }
}

/** A failed write is logged, not thrown: the theme still applies for this page. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    console.warn('levelpath: could not store the theme', err);
  }
}

export const initialTheme = (): Theme => loadTheme() ?? systemTheme();

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
