import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTheme } from './theme';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/App.css', 'utf8');

function stubOs(dark: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark') }));
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadTheme', () => {
  it('follows the OS when nothing is stored', () => {
    stubOs(true);
    expect(loadTheme()).toBe('dark');
    stubOs(false);
    expect(loadTheme()).toBe('light');
  });

  it('is light without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(loadTheme()).toBe('light');
  });

  it('prefers the stored value over the OS and ignores invalid values', () => {
    stubOs(true);
    localStorage.setItem('levelpath.theme', 'light');
    expect(loadTheme()).toBe('light');
    localStorage.setItem('levelpath.theme', 'blue');
    expect(loadTheme()).toBe('dark');
  });

  it('falls back and warns when storage throws', () => {
    stubOs(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadTheme()).toBe('dark');
    expect(warn).toHaveBeenCalled();
  });
});

describe('inline script in index.html', () => {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  const run = () => new Function(match![1])();

  it('comes before the module script', () => {
    expect(match).not.toBeNull();
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'));
  });

  it.each([
    ['stored dark, OS light', 'dark', false, 'dark'],
    ['stored light, OS dark', 'light', true, 'light'],
    ['stored invalid, OS dark', 'blue', true, 'dark'],
    ['none, OS dark', null, true, 'dark'],
    ['none, OS light', null, false, 'light'],
  ])('%s', (_name, stored, os, expected) => {
    if (stored) localStorage.setItem('levelpath.theme', stored);
    stubOs(os);
    run();
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it('does not throw when storage throws', () => {
    stubOs(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(run).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

function block(selector: string): Record<string, string> {
  const m = new RegExp(`${selector.replace(/[[\]'.]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  const out: Record<string, string> = {};
  for (const [, k, v] of m![1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}

const light = block(':root');
const dark = block(":root[data-theme='dark']");

// The colours App.css had before the tokens (git show origin/main:apps/web/src/App.css).
const ORIGINAL_LIGHT: Record<string, string> = {
  '--page-bg': '#ffffff',
  '--text': '#1a1a1a',
  '--text-muted': '#4b5563',
  '--border-strong': '#4b5563',
  '--border-dashed': '#6b7280',
  '--border-soft': '#d1d5db',
  '--accent': '#1d4ed8',
  '--on-accent': '#ffffff',
  '--disabled-bg': '#e5e7eb',
  '--disabled-border': '#d1d5db',
  '--disabled-text': '#4b5563',
  '--input-bg': '#ffffff',
  '--form-note': '#374151',
  '--badge-draft-bg': '#e5e7eb',
  '--badge-draft-text': '#1f2937',
  '--badge-submitted-bg': '#dbeafe',
  '--badge-submitted-text': '#1e3a8a',
  '--badge-approved-bg': '#dcfce7',
  '--badge-approved-text': '#14532d',
  '--badge-rejected-bg': '#fee2e2',
  '--badge-rejected-text': '#7f1d1d',
  '--error-border': '#991b1b',
  '--error-bg': '#fef2f2',
  '--error-text': '#7f1d1d',
  '--field-error': '#991b1b',
  '--tag-bg': '#dbeafe',
  '--tag-text': '#1e3a8a',
  '--secondary-bg': '#ffffff',
  '--secondary-text': '#1d4ed8',
};

describe('App.css tokens', () => {
  it('has no hex colour outside the two token blocks', () => {
    const rest = css.replace(/:root(\[data-theme='dark'\])?\s*\{[^}]*\}/g, '');
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('keeps the light values unchanged', () => {
    expect(light).toEqual(ORIGINAL_LIGHT);
  });

  it('defines the same tokens in dark', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['--text', '--page-bg'],
  ['--text-muted', '--page-bg'],
  ['--on-accent', '--accent'],
  ['--disabled-text', '--disabled-bg'],
  ['--text', '--input-bg'],
  ['--form-note', '--page-bg'],
  ['--badge-draft-text', '--badge-draft-bg'],
  ['--badge-submitted-text', '--badge-submitted-bg'],
  ['--badge-approved-text', '--badge-approved-bg'],
  ['--badge-rejected-text', '--badge-rejected-bg'],
  ['--error-text', '--error-bg'],
  ['--field-error', '--page-bg'],
  ['--tag-text', '--tag-bg'],
  ['--secondary-text', '--secondary-bg'],
];
const BORDERS = [
  '--border-strong',
  '--border-dashed',
  '--border-soft',
  '--accent',
  '--error-border',
];

describe('contrast', () => {
  it.each(TEXT_PAIRS)('dark %s on %s is at least 4.5', (fg, bg) => {
    expect(contrast(dark[fg], dark[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BORDERS)('dark %s against the page is at least 3', (b) => {
    expect(contrast(dark[b], dark['--page-bg'])).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ['--text', '--page-bg'],
    ['--on-accent', '--accent'],
  ])('light %s on %s is at least 4.5', (fg, bg) => {
    expect(contrast(light[fg], light[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
