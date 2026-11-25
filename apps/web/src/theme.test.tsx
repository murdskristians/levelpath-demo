import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { me, mockFetch, supplier } from './test/fixtures';
import { USERS } from './users';

const [ALICE, AMIR] = USERS.map((u) => u.id);
const USER_KEY = 'levelpath.userId';
const THEME_KEY = 'levelpath.theme';

const root = document.documentElement;
const theme = () => root.dataset.theme;

function stubOs(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: dark && query.includes('dark'), media: query })),
  );
}

function mockApi(userId: string) {
  mockFetch({
    'GET /me': me(userId),
    'GET /suppliers': [supplier()],
    'GET /purchase-requests/mine': [],
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete root.dataset.theme;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme', () => {
  describe('OS default', () => {
    it('is dark when the OS prefers dark and nothing is stored', () => {
      stubOs(true);
      render(<App />);
      expect(theme()).toBe('dark');
    });

    it('is light when the OS does not prefer dark', () => {
      stubOs(false);
      render(<App />);
      expect(theme()).toBe('light');
    });
  });

  describe('stored choice', () => {
    it('beats the OS: light over dark', () => {
      stubOs(true);
      localStorage.setItem(THEME_KEY, 'light');
      render(<App />);
      expect(theme()).toBe('light');
    });

    it('beats the OS: dark over light', () => {
      stubOs(false);
      localStorage.setItem(THEME_KEY, 'dark');
      render(<App />);
      expect(theme()).toBe('dark');
    });

    it('ignores an invalid value', () => {
      stubOs(true);
      localStorage.setItem(THEME_KEY, 'purple');
      render(<App />);
      expect(theme()).toBe('dark');
    });
  });

  describe('toggle', () => {
    it('switches both ways, stores the choice and renames itself', () => {
      stubOs(false);
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
      expect(theme()).toBe('dark');
      expect(localStorage.getItem(THEME_KEY)).toBe('dark');
      fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
      expect(theme()).toBe('light');
      expect(localStorage.getItem(THEME_KEY)).toBe('light');
      expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
    });

    it('survives a reload', () => {
      stubOs(false);
      const first = render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
      first.unmount();
      delete root.dataset.theme;
      render(<App />);
      expect(theme()).toBe('dark');
    });

    it('survives switching users', async () => {
      stubOs(false);
      mockApi(ALICE);
      localStorage.setItem(USER_KEY, ALICE);
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
      mockApi(AMIR);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: AMIR } });
      await screen.findByText('Amir');
      expect(theme()).toBe('dark');
      expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
    });

    it('is in the header with no user picked', () => {
      stubOs(false);
      render(<App />);
      const header = screen.getByRole('banner');
      expect(within(header).getByRole('button', { name: /^Switch to/ })).toBeTruthy();
    });

    it('is in the header with a user picked', async () => {
      stubOs(false);
      mockApi(ALICE);
      localStorage.setItem(USER_KEY, ALICE);
      render(<App />);
      await screen.findByText('Alice');
      const header = screen.getByRole('banner');
      expect(within(header).getByRole('button', { name: /^Switch to/ })).toBeTruthy();
    });
  });

  describe('inline script', () => {
    const html = readFileSync('index.html', 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const script = /<script>([\s\S]*?)<\/script>/.exec(head)?.[1] ?? '';

    function run(storage: unknown, matchMedia: unknown) {
      delete root.dataset.theme;
      new Function('localStorage', 'matchMedia', script)(storage, matchMedia);
      return theme();
    }
    const media = (dark: boolean) => () => ({ matches: dark });
    const store = (value: string | null) => ({ getItem: () => value });

    it('sits in <head> before the module script', () => {
      expect(script).not.toBe('');
      expect(html.indexOf(script)).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
    });

    it('uses the OS when nothing is stored', () => {
      expect(run(store(null), media(true))).toBe('dark');
      expect(run(store(null), media(false))).toBe('light');
    });

    it('prefers the stored choice', () => {
      expect(run(store('light'), media(true))).toBe('light');
    });

    it('falls back to light when storage throws', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const throwing = {
        getItem: () => {
          throw new Error('denied');
        },
      };
      expect(run(throwing, media(true))).toBe('light');
    });
  });

  describe('stylesheet', () => {
    const css = readFileSync('src/App.css', 'utf8');
    const block = (selector: string) => {
      const start = css.indexOf(selector);
      const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
      return Object.fromEntries(
        [...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/g)].map(([, k, v]) => [k, v]),
      );
    };
    const themes = {
      light: block(':root {'),
      dark: block(":root[data-theme='dark']"),
    };

    const channel = (n: number) => {
      const c = n / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };

    // [foreground, background, minimum ratio]
    const pairs: [string, string, number][] = [
      ['--text', '--bg', 4.5],
      ['--text-muted', '--bg', 4.5],
      ['--text-note', '--bg', 4.5],
      ['--primary-text', '--primary', 4.5],
      ['--secondary-text', '--secondary-bg', 4.5],
      ['--disabled-text', '--disabled-bg', 4.5],
      ['--text', '--input-bg', 4.5],
      ['--badge-draft-text', '--badge-draft-bg', 4.5],
      ['--badge-submitted-text', '--badge-submitted-bg', 4.5],
      ['--badge-approved-text', '--badge-approved-bg', 4.5],
      ['--badge-rejected-text', '--badge-rejected-bg', 4.5],
      ['--tag-text', '--tag-bg', 4.5],
      ['--error-text', '--error-bg', 4.5],
      ['--field-error-text', '--bg', 4.5],
      ['--border-input', '--bg', 3],
      ['--border-empty', '--bg', 3],
      ['--focus', '--bg', 3],
      ['--primary', '--bg', 3],
      ['--error-border', '--bg', 3],
    ];

    for (const name of ['light', 'dark'] as const) {
      it(`meets WCAG AA in the ${name} theme`, () => {
        const t = themes[name];
        for (const [fg, bg, min] of pairs) {
          expect(t[fg], `${name} ${fg}`).toBeDefined();
          expect(t[bg], `${name} ${bg}`).toBeDefined();
          expect(ratio(t[fg]!, t[bg]!), `${name} ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
        }
      });
    }

    it('defines the same tokens in both themes', () => {
      expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
    });

    it('keeps the light values of the original stylesheet', () => {
      expect(themes.light['--text']).toBe('#1a1a1a');
      expect(themes.light['--bg']).toBe('#ffffff');
      expect(themes.light['--primary']).toBe('#1d4ed8');
      expect(themes.light['--error-text']).toBe('#7f1d1d');
    });

    it('has hex colors only inside the two theme blocks', () => {
      const rules = css.replace(/:root[^{]*\{[^}]*\}/g, '');
      expect(rules).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    });
  });
});
