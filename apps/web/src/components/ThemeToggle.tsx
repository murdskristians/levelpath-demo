import type { Theme } from '../theme';

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button type="button" className="theme-toggle" onClick={onToggle}>
      {theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
    </button>
  );
}
