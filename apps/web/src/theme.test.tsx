import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { me, mockFetch, supplier } from './test/fixtures';
import { THEME_KEY } from './theme';
import { USERS } from './users';

const [ALICE, AMIR] = USERS.map((u) => u.id);

function stubOs(dark: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: dark && q.includes('dark'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

const html = () => document.documentElement;
const toDark = () => screen.getByRole('button', { name: 'Switch to dark theme' });
const toLight = () => screen.getByRole('button', { name: 'Switch to light theme' });

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme in App', () => {
  it('follows the OS when nothing is stored', () => {
    mockFetch({});
    stubOs(true);
    render(<App />);
    expect(html().dataset.theme).toBe('dark');
    expect(toLight()).toBeTruthy();
    cleanup();

    stubOs(false);
    render(<App />);
    expect(html().dataset.theme).toBe('light');
    expect(toDark()).toBeTruthy();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('flips and stores the choice on click', () => {
    mockFetch({});
    stubOs(false);
    render(<App />);
    fireEvent.click(toDark());
    expect(html().dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    fireEvent.click(toLight());
    expect(html().dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('lets a stored choice beat the OS', () => {
    mockFetch({});
    stubOs(true);
    localStorage.setItem(THEME_KEY, 'light');
    render(<App />);
    expect(html().dataset.theme).toBe('light');
    cleanup();

    stubOs(false);
    localStorage.setItem(THEME_KEY, 'dark');
    render(<App />);
    expect(html().dataset.theme).toBe('dark');
  });

  it('ignores an invalid stored value', () => {
    mockFetch({});
    stubOs(true);
    localStorage.setItem(THEME_KEY, 'purple');
    render(<App />);
    expect(html().dataset.theme).toBe('dark');
  });

  it('keeps the theme when the user is switched', async () => {
    mockFetch({
      'GET /me': me(ALICE),
      'GET /suppliers': [supplier()],
      'GET /purchase-requests/mine': [],
    });
    stubOs(false);
    localStorage.setItem('levelpath.userId', ALICE);
    render(<App />);
    fireEvent.click(toDark());
    fireEvent.change(screen.getByLabelText('User'), { target: { value: AMIR } });
    await waitFor(() => expect(html().dataset.theme).toBe('dark'));
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(toLight()).toBeTruthy();
  });

  it('shows the toggle with and without a user', async () => {
    mockFetch({
      'GET /me': me(ALICE),
      'GET /suppliers': [supplier()],
      'GET /purchase-requests/mine': [],
    });
    stubOs(false);
    render(<App />);
    expect(screen.getByRole('banner').contains(toDark())).toBe(true);
    cleanup();

    localStorage.setItem('levelpath.userId', ALICE);
    render(<App />);
    await screen.findByRole('heading', { name: 'Purchase requests' });
    expect(screen.getByRole('banner').contains(toDark())).toBe(true);
  });

  it('renders and warns when storage throws', () => {
    mockFetch({});
    stubOs(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === THEME_KEY) throw new Error('x');
      return null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('x');
    });
    render(<App />);
    expect(html().dataset.theme).toBe('dark');
    expect(warn).toHaveBeenCalled();
    fireEvent.click(toLight());
    expect(html().dataset.theme).toBe('light');
  });
});

describe('inline script in index.html', () => {
  const source = readFileSync('index.html', 'utf8');
  const head = source.slice(0, source.indexOf('</head>'));
  const body = /<script>([\s\S]*?)<\/script>/.exec(head)?.[1] ?? '';

  it('is in the head and has no comment-only catch', () => {
    expect(body).not.toBe('');
    expect(body).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*(\/[/*][^}]*)?\}/);
  });

  it.each([
    [true, null, 'dark'],
    [false, null, 'light'],
    [false, 'dark', 'dark'],
    [true, 'light', 'light'],
    [true, 'garbage', 'dark'],
    [false, 'garbage', 'light'],
  ])('os dark=%s stored=%s gives %s', (dark, stored, expected) => {
    stubOs(dark);
    if (stored) localStorage.setItem(THEME_KEY, stored);
    new Function(body)();
    expect(html().dataset.theme).toBe(expected);
  });
});

describe('App.css', () => {
  const css = readFileSync('src/App.css', 'utf8');
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf('}', start) + 1);
  };
  const light = block(':root');
  const dark = block("[data-theme='dark']");

  it('has hex colors only in the two variable blocks', () => {
    const rest = css.replace(light, '').replace(dark, '');
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  const vars = (b: string) =>
    Object.fromEntries(
      [...b.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
    );
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const pairs: [string, string, number][] = [
    ['--text', '--bg', 4.5],
    ['--text-muted', '--bg', 4.5],
    ['--text-note', '--bg', 4.5],
    ['--on-primary', '--primary', 4.5],
    ['--disabled-text', '--disabled-bg', 4.5],
    ['--secondary-text', '--secondary-bg', 4.5],
    ['--text', '--input-bg', 4.5],
    ['--badge-draft-fg', '--badge-draft-bg', 4.5],
    ['--badge-sub-fg', '--badge-sub-bg', 4.5],
    ['--badge-ok-fg', '--badge-ok-bg', 4.5],
    ['--badge-no-fg', '--badge-no-bg', 4.5],
    ['--tag-fg', '--tag-bg', 4.5],
    ['--error-text', '--error-bg', 4.5],
    ['--field-error', '--bg', 4.5],
    ['--border-strong', '--bg', 3],
    ['--empty-border', '--bg', 3],
    ['--focus', '--bg', 3],
  ];

  describe.each([
    ['light', light],
    ['dark', dark],
  ])('%s theme contrast', (_name, b) => {
    const v = vars(b);
    it.each(pairs)('%s on %s is at least %s', (fg, bg, min) => {
      expect(v[fg]).toBeTruthy();
      expect(ratio(v[fg], v[bg])).toBeGreaterThanOrEqual(min);
    });
  });
});
