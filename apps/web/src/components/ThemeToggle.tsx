import type { Theme } from '../theme';

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="theme-toggle secondary"
      aria-pressed={theme === 'dark'}
      onClick={onToggle}
    >
      Dark theme
    </button>
  );
}
