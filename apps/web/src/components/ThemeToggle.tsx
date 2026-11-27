import type { Theme } from '../theme';

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="secondary theme-toggle" onClick={onToggle}>
      {`Switch to ${next} theme`}
    </button>
  );
}
