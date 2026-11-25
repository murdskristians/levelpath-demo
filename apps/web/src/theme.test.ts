import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTheme, THEME_KEY } from './theme';

const stubOs = (dark: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: dark })),
  );

describe('resolveTheme', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lets a stored choice win over the OS, both ways', () => {
    stubOs(true);
    localStorage.setItem(THEME_KEY, 'light');
    expect(resolveTheme()).toBe('light');
    stubOs(false);
    localStorage.setItem(THEME_KEY, 'dark');
    expect(resolveTheme()).toBe('dark');
  });

  it('follows the OS when nothing is stored', () => {
    stubOs(true);
    expect(resolveTheme()).toBe('dark');
    stubOs(false);
    expect(resolveTheme()).toBe('light');
  });

  it('ignores an invalid stored value', () => {
    stubOs(true);
    localStorage.setItem(THEME_KEY, 'purple');
    expect(resolveTheme()).toBe('dark');
  });

  it('is light when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveTheme()).toBe('light');
  });

  it('falls back to the OS when reading localStorage throws, and logs it', () => {
    stubOs(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(resolveTheme()).toBe('dark');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('inline script in index.html', () => {
  const html = readFileSync('index.html', 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  /** Runs the script against a stubbed window and returns the data-theme it set. */
  function run(stored: string | null, osDark: boolean) {
    const attrs: Record<string, string> = {};
    const win = {
      localStorage: { getItem: () => stored },
      matchMedia: () => ({ matches: osDark }),
    };
    new Function('window', 'localStorage', 'document', script)(win, win.localStorage, {
      documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
    });
    return attrs['data-theme'];
  }

  it('comes before the module script', () => {
    expect(script).not.toBe('');
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'));
  });

  it.each([
    ['dark', true, 'dark'],
    ['light', true, 'light'],
    [null, true, 'dark'],
    [null, false, 'light'],
    ['dark', false, 'dark'],
    ['purple', true, 'dark'],
  ] as const)('stored %s, OS dark=%s gives %s, like resolveTheme', (stored, osDark, expected) => {
    expect(run(stored, osDark)).toBe(expected);
    if (stored) localStorage.setItem(THEME_KEY, stored);
    stubOs(osDark);
    expect(resolveTheme()).toBe(expected);
    localStorage.clear();
    vi.unstubAllGlobals();
  });
});

describe('App.css', () => {
  it('has hex colors only inside the two palette blocks', () => {
    const css = readFileSync('src/App.css', 'utf8');
    const outside = css
      .replace(/:root(\[data-theme='dark'\])?\s*\{[^}]*\}/g, '')
      .match(/#[0-9a-fA-F]{3,6}\b/g);
    expect(outside).toBeNull();
  });
});
