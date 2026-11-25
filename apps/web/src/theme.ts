export const THEME_KEY = 'levelpath.theme';

export type Theme = 'light' | 'dark';

/** The stored choice, else the OS preference, else light. Never throws. */
export function resolveTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Expected environment condition (no or blocked storage): fall through to the OS preference.
  }
  try {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch {
    // Expected environment condition (matchMedia unusable): fall back to light.
  }
  return 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // By design a no-op: storage that refuses writes must not stop the switch.
  }
}
