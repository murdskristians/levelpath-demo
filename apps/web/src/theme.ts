export type Theme = 'light' | 'dark';
export const THEME_KEY = 'levelpath.theme';

export function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch (err) {
    console.warn('theme: could not read the stored theme', err);
  }
  return systemTheme();
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    console.warn('theme: could not store the theme', err);
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** The theme the inline script in index.html already set, else the stored or OS one. */
export function initialTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === 'light' || attr === 'dark' ? attr : loadTheme();
}
