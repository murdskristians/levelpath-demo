import { useEffect, useState } from 'react';
import { applyTheme, currentTheme, saveTheme, type Theme } from '../theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  function toggle() {
    saveTheme(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      onClick={toggle}
    >
      {theme === 'dark' ? 'Light theme' : 'Dark theme'}
    </button>
  );
}
