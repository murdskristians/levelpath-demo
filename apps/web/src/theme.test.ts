import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInitialTheme, saveTheme } from './theme';

const stubMedia = (dark: boolean) =>
  vi.stubGlobal('matchMedia', () => ({ matches: dark }) as MediaQueryList);

describe('theme', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prefers a stored value over the system setting', () => {
    stubMedia(true);
    localStorage.setItem('levelpath.theme', 'light');
    expect(getInitialTheme()).toBe('light');
  });

  it('uses the system setting for an invalid stored value', () => {
    stubMedia(true);
    localStorage.setItem('levelpath.theme', 'purple');
    expect(getInitialTheme()).toBe('dark');
  });

  it('ends in light with a bad stored value and no matchMedia', () => {
    localStorage.setItem('levelpath.theme', 'purple');
    expect(getInitialTheme()).toBe('light');
  });

  it('ends in light when storage throws and matchMedia is missing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getInitialTheme()).toBe('light');
  });

  it('warns instead of throwing when saving fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => saveTheme('dark')).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('index.html sets data-theme before the bundle loads', () => {
    const html = readFileSync('index.html', 'utf8');
    const script = html.indexOf('<script>');
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(html.indexOf('type="module"'));
    const inline = html.slice(script, html.indexOf('</script>', script));
    expect(inline).toContain('levelpath.theme');
    expect(inline).toContain('prefers-color-scheme');
    expect(inline).toContain('documentElement.dataset.theme');
    expect(inline).toMatch(/try\s*{[\s\S]*}\s*catch/);
  });
});
