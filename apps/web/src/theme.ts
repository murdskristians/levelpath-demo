export const THEME_KEY = 'levelpath.theme';

export type Theme = 'light' | 'dark';

/** The stored choice, or null when missing, invalid or unreadable. */
export function loadStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch (err) {
    console.warn('levelpath: cannot read the stored theme', err);
    return null;
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (err) {
    console.warn('levelpath: cannot read prefers-color-scheme', err);
    return 'light';
  }
}

/** The theme to use: the stored choice, else the OS setting. */
export function resolveTheme(): Theme {
  return loadStoredTheme() ?? systemTheme();
}

/** The theme on <html> (set before first paint by index.html), else the rule. */
export function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  return set === 'light' || set === 'dark' ? set : resolveTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    console.warn('levelpath: cannot store the theme', err);
  }
}
