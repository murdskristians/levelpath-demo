import type { Theme } from '../theme';

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      onClick={onToggle}
    >
      <span aria-hidden="true">{next === 'dark' ? '☾' : '☀'}</span>{' '}
      {next === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}
