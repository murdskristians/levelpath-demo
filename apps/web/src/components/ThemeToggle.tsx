import type { Theme } from '../theme';

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === 'dark';
  return (
    <button type="button" className="secondary theme-toggle" onClick={onToggle}>
      <span aria-hidden="true">{dark ? '☀️' : '🌙'}</span>{' '}
      {dark ? 'Switch to light theme' : 'Switch to dark theme'}
    </button>
  );
}
