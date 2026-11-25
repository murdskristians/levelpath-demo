import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { me, mockFetch, supplier } from './test/fixtures';
import { loadTheme, THEME_KEY } from './theme';
import { USERS } from './users';

const [ALICE, AMIR] = USERS.map((u) => u.id);
const USER_KEY = 'levelpath.userId';

const base = (userId: string) => ({
  'GET /me': me(userId),
  'GET /suppliers': [supplier()],
  'GET /purchase-requests/mine': [],
});

const stubOs = (dark: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark') }));
const theme = () => document.documentElement.dataset.theme;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('initial theme', () => {
  it('follows the OS when nothing is stored', () => {
    mockFetch({});
    stubOs(true);
    render(<App />);
    expect(theme()).toBe('dark');
    cleanup();
    stubOs(false);
    render(<App />);
    expect(theme()).toBe('light');
  });

  it('is light without matchMedia', () => {
    mockFetch({});
    render(<App />);
    expect(theme()).toBe('light');
  });

  it('prefers the stored choice over the OS', () => {
    mockFetch({});
    localStorage.setItem(THEME_KEY, 'light');
    stubOs(true);
    render(<App />);
    expect(theme()).toBe('light');
    cleanup();
    localStorage.setItem(THEME_KEY, 'dark');
    stubOs(false);
    render(<App />);
    expect(theme()).toBe('dark');
  });

  it('ignores an invalid stored value', () => {
    mockFetch({});
    localStorage.setItem(THEME_KEY, 'blue');
    stubOs(true);
    render(<App />);
    expect(theme()).toBe('dark');
  });

  it('falls back to the OS and warns when storage throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    stubOs(true);
    expect(loadTheme()).toBe('dark');
    expect(warn).toHaveBeenCalled();
  });
});

describe('toggle', () => {
  it('flips, stores and renames the button, both ways', () => {
    mockFetch({});
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(theme()).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(theme()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
  });

  it('still flips when saving throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch({});
    render(<App />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(theme()).toBe('dark');
    expect(warn).toHaveBeenCalled();
  });

  it('is in the header with no user picked', () => {
    mockFetch({});
    render(<App />);
    const header = screen.getByRole('banner');
    expect(within(header).getByLabelText('User')).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
  });

  it('is in the header with a user picked', async () => {
    localStorage.setItem(USER_KEY, ALICE);
    mockFetch(base(ALICE));
    render(<App />);
    const header = screen.getByRole('banner');
    expect(within(header).getByLabelText('User')).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
    await screen.findByText('No purchase requests yet.');
  });

  it('survives a user switch and a reload', async () => {
    localStorage.setItem(USER_KEY, ALICE);
    mockFetch({ ...base(ALICE), ...base(AMIR) });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    fireEvent.change(screen.getByLabelText('User'), { target: { value: AMIR } });
    expect(theme()).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
    await screen.findByText('Amir');
    cleanup();
    delete document.documentElement.dataset.theme;
    render(<App />);
    expect(theme()).toBe('dark');
  });
});

describe('index.html script', () => {
  const html = readFileSync('index.html', 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const m = /<script>([\s\S]*?)<\/script>/.exec(head);

  it('is an inline script in <head> before the module script', () => {
    expect(m).not.toBeNull();
    expect(html.indexOf(m![0])).toBeLessThan(html.indexOf('type="module"'));
  });

  const run = () => new Function(m![1])();

  it.each([
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    [null, true, 'dark'],
    [null, false, 'light'],
  ])('stored %s, OS dark %s gives %s', (stored, osDark, expected) => {
    if (stored) localStorage.setItem(THEME_KEY, stored);
    stubOs(osDark);
    run();
    expect(theme()).toBe(expected);
  });

  it('falls back to the OS when storage throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    stubOs(true);
    expect(run).not.toThrow();
    expect(theme()).toBe('dark');
    expect(warn).toHaveBeenCalled();
  });
});

describe('App.css palette', () => {
  const css = readFileSync('src/App.css', 'utf8');
  const lightBlock = /:root \{([^}]*)\}/.exec(css)![1];
  const darkBlock = /:root\[data-theme='dark'\] \{([^}]*)\}/.exec(css)![1];
  const parse = (block: string) =>
    Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map((x) => [x[1], x[2]]),
    );
  const light = parse(lightBlock);
  const dark = parse(darkBlock);

  const ORIGINAL: Record<string, string> = {
    bg: '#ffffff',
    text: '#1a1a1a',
    muted: '#4b5563',
    'form-note': '#374151',
    border: '#d1d5db',
    'empty-border': '#6b7280',
    'input-bg': '#ffffff',
    'input-border': '#4b5563',
    accent: '#1d4ed8',
    'on-accent': '#ffffff',
    focus: '#1d4ed8',
    'secondary-bg': '#ffffff',
    'secondary-text': '#1d4ed8',
    'disabled-bg': '#e5e7eb',
    'disabled-border': '#d1d5db',
    'disabled-text': '#4b5563',
    'draft-bg': '#e5e7eb',
    'draft-text': '#1f2937',
    'submitted-bg': '#dbeafe',
    'submitted-text': '#1e3a8a',
    'approved-bg': '#dcfce7',
    'approved-text': '#14532d',
    'rejected-bg': '#fee2e2',
    'rejected-text': '#7f1d1d',
    'error-bg': '#fef2f2',
    'error-text': '#7f1d1d',
    'error-border': '#991b1b',
    'field-error': '#991b1b',
    'tag-bg': '#dbeafe',
    'tag-text': '#1e3a8a',
  };

  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const TEXT_PAIRS: [string, string][] = [
    ['text', 'bg'],
    ['muted', 'bg'],
    ['form-note', 'bg'],
    ['on-accent', 'accent'],
    ['secondary-text', 'secondary-bg'],
    ['draft-text', 'draft-bg'],
    ['submitted-text', 'submitted-bg'],
    ['approved-text', 'approved-bg'],
    ['rejected-text', 'rejected-bg'],
    ['error-text', 'error-bg'],
    ['error-text', 'bg'],
    ['field-error', 'bg'],
    ['tag-text', 'tag-bg'],
    ['text', 'input-bg'],
    ['disabled-text', 'disabled-bg'],
  ];
  const BOUNDARY_PAIRS: [string, string][] = [
    ['input-border', 'bg'],
    ['focus', 'bg'],
    ['accent', 'bg'],
    ['empty-border', 'bg'],
  ];

  it('has no hex colour outside the two palette blocks', () => {
    const rest = css.replace(lightBlock, '').replace(darkBlock, '');
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('keeps the original light values', () => {
    expect(light).toEqual(ORIGINAL);
  });

  it('defines the same variables in both themes', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  for (const [name, p] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it.each(TEXT_PAIRS)(`${name}: %s on %s is at least 4.5:1`, (fg, bg) => {
      expect(ratio(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
    });
    it.each(BOUNDARY_PAIRS)(`${name}: %s against %s is at least 3:1`, (fg, bg) => {
      expect(ratio(p[fg], p[bg])).toBeGreaterThanOrEqual(3);
    });
  }
});
