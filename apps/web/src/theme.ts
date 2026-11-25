export const THEME_KEY = 'levelpath.theme';

export type Theme = 'light' | 'dark';

function stored(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (err) {
    console.error('theme: could not read the stored choice', err);
    return null;
  }
}

/** The stored choice wins; otherwise the OS preference; otherwise light. Keep in step with index.html. */
export function resolveTheme(): Theme {
  const value = stored();
  if (value === 'light' || value === 'dark') return value;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    console.error('theme: could not store the choice', err);
  }
}
