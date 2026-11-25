export type Theme = 'light' | 'dark';

export const THEME_KEY = 'levelpath.theme';

function osTheme(): Theme {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** The stored choice, else the OS preference. Keep in step with the inline script in index.html. */
export function loadTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch (err) {
    console.warn('levelpath: theme storage unavailable', err);
  }
  return stored === 'light' || stored === 'dark' ? stored : osTheme();
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    console.warn('levelpath: theme could not be saved', err);
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
