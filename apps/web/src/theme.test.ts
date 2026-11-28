import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTheme } from './theme';

const css = readFileSync('src/App.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

function tokens(selector: string): Record<string, string> {
  const block = css.slice(css.indexOf(selector)).match(/{([^}]*)}/)![1];
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]),
  );
}
const light = tokens(':root {');
const dark = tokens(":root[data-theme='dark']");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [foreground, background, minimum ratio]
const pairs: [string, string, number][] = [
  ['--text', '--bg', 4.5],
  ['--text-muted', '--bg', 4.5],
  ['--text-form-note', '--bg', 4.5],
  ['--input-text', '--input-bg', 4.5],
  ['--on-accent', '--accent', 4.5],
  ['--secondary-text', '--secondary-bg', 4.5],
  ['--disabled-text', '--disabled-bg', 4.5],
  ['--badge-draft-text', '--badge-draft-bg', 4.5],
  ['--badge-submitted-text', '--badge-submitted-bg', 4.5],
  ['--badge-approved-text', '--badge-approved-bg', 4.5],
  ['--badge-rejected-text', '--badge-rejected-bg', 4.5],
  ['--error-text', '--error-bg', 4.5],
  ['--field-error', '--bg', 4.5],
  ['--border-input', '--input-bg', 3],
  ['--border-dashed', '--bg', 3],
  ['--focus', '--bg', 3],
  ['--accent', '--bg', 3],
  ['--error-border', '--error-bg', 3],
];

describe('theme tokens', () => {
  it.each([
    ['light', light],
    ['dark', dark],
  ])('%s palette meets WCAG AA', (_name, t) => {
    for (const [fg, bg, min] of pairs) {
      expect(t[fg], fg).toBeDefined();
      expect(ratio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('keeps the light values of today', () => {
    expect(light['--bg']).toBe('#ffffff');
    expect(light['--text']).toBe('#1a1a1a');
    expect(light['--accent']).toBe('#1d4ed8');
  });

  it('defines the same tokens in both themes and no hex elsewhere', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    const rest = css.replace(/:root[^{]*{[^}]*}/g, '');
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('loadTheme', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs and falls back to the OS when storage throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(loadTheme()).toBe('dark');
    expect(warn).toHaveBeenCalled();
  });
});

describe('inline script in index.html', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const run = () => new Function(script)();
  const root = document.documentElement;
  afterEach(() => {
    delete root.dataset.theme;
    root.style.colorScheme = '';
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('comes before the module script', () => {
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'));
  });

  it('follows a dark OS when nothing is stored', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    run();
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('prefers the stored choice', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    localStorage.setItem('levelpath.theme', 'light');
    run();
    expect(root.dataset.theme).toBe('light');
  });

  it('warns and uses light when storage throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    run();
    expect(root.dataset.theme).toBe('light');
    expect(warn).toHaveBeenCalled();
  });
});
