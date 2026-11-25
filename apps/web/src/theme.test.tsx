import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { me, mockFetch, supplier } from './test/fixtures';
import { THEME_KEY } from './theme';
import { USERS } from './users';

const [ALICE, , BELLA] = USERS.map((u) => u.id);
const root = document.documentElement;

function stubOs(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: dark })),
  );
}

describe('theme', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    root.removeAttribute('data-theme');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('App', () => {
    it.each([
      [false, 'light', 'Switch to dark theme'],
      [true, 'dark', 'Switch to light theme'],
    ])('follows the OS when nothing is stored (dark=%s)', (dark, theme, name) => {
      stubOs(dark);
      mockFetch({});
      render(<App />);

      expect(screen.getByRole('button', { name })).toBeTruthy();
      expect(root.dataset.theme).toBe(theme);
    });

    it('toggles, flips the name and stores the choice', () => {
      stubOs(false);
      mockFetch({});
      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
      expect(root.dataset.theme).toBe('dark');
      expect(localStorage.getItem(THEME_KEY)).toBe('dark');

      fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
      expect(root.dataset.theme).toBe('light');
      expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
      expect(localStorage.getItem(THEME_KEY)).toBe('light');
    });

    it.each([
      ['light', true],
      ['dark', false],
    ])('a stored %s beats the OS (dark=%s)', (stored, dark) => {
      localStorage.setItem(THEME_KEY, stored);
      stubOs(dark);
      mockFetch({});
      render(<App />);

      expect(root.dataset.theme).toBe(stored);
    });

    it('writes nothing without a click', () => {
      stubOs(true);
      mockFetch({});
      render(<App />);

      expect(localStorage.getItem(THEME_KEY)).toBeNull();
    });

    it('ignores an invalid stored value', () => {
      localStorage.setItem(THEME_KEY, 'purple');
      stubOs(false);
      mockFetch({});
      render(<App />);

      expect(root.dataset.theme).toBe('light');
    });

    it('survives a throwing getItem', () => {
      const getItem = Storage.prototype.getItem;
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
        if (key === THEME_KEY) throw new Error('blocked');
        return getItem.call(this, key);
      });
      stubOs(true);
      mockFetch({});
      expect(() => render(<App />)).not.toThrow();
      expect(root.dataset.theme).toBe('dark');
    });

    it('still switches when setItem throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full');
      });
      stubOs(false);
      mockFetch({});
      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
      expect(root.dataset.theme).toBe('dark');
      expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
    });

    it('falls back to light when matchMedia is undefined', () => {
      vi.stubGlobal('matchMedia', undefined);
      mockFetch({});
      expect(() => render(<App />)).not.toThrow();
      expect(root.dataset.theme).toBe('light');
    });

    it('keeps the theme when the user is switched, and shows the toggle with no user', async () => {
      stubOs(false);
      mockFetch({
        'GET /me': (c: { headers: Record<string, string> }) => me(c.headers['X-User-Id']),
        'GET /suppliers': [supplier()],
        'GET /purchase-requests/mine': [],
      });
      render(<App />);
      expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();

      fireEvent.change(screen.getByLabelText('User'), { target: { value: ALICE } });
      await screen.findByText('Alice');
      fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
      fireEvent.change(screen.getByLabelText('User'), { target: { value: BELLA } });
      await screen.findByText('Bella');

      expect(root.dataset.theme).toBe('dark');
      expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
    });
  });

  describe('inline script in index.html', () => {
    const html = readFileSync('index.html', 'utf8');
    const code = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

    function run(opts: { stored?: unknown; dark?: boolean; throwing?: boolean }) {
      const localStorage = {
        getItem() {
          if (opts.throwing) throw new Error('blocked');
          return opts.stored ?? null;
        },
      };
      const matchMedia = () => ({ matches: opts.dark ?? false });
      const attrs: Record<string, string> = {};
      const document = {
        documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
      };
      new Function('localStorage', 'matchMedia', 'document', code)(
        localStorage,
        matchMedia,
        document,
      );
      return attrs['data-theme'];
    }

    it('finds the script', () => {
      expect(code).not.toBe('');
    });
    it('uses a stored dark', () => expect(run({ stored: 'dark' })).toBe('dark'));
    it('prefers stored light over an OS dark', () =>
      expect(run({ stored: 'light', dark: true })).toBe('light'));
    it('follows an OS dark when nothing is stored', () => expect(run({ dark: true })).toBe('dark'));
    it('ignores an invalid stored value', () =>
      expect(run({ stored: 'purple', dark: false })).toBe('light'));
    it('does not throw when localStorage throws', () => {
      expect(run({ throwing: true, dark: true })).toBe('dark');
    });
  });

  describe('App.css palette', () => {
    const css = readFileSync('src/App.css', 'utf8');
    const lightRe = /:root \{([^}]*)\}/;
    const darkRe = /:root\[data-theme='dark'\] \{([^}]*)\}/;

    function props(block: string) {
      return Object.fromEntries(
        [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
      );
    }
    const light = props(lightRe.exec(css)![1]);
    const dark = props(darkRe.exec(css)![1]);

    it('has no hex color outside the two palette blocks', () => {
      const rest = css.replace(lightRe, '').replace(darkRe, '');
      expect(rest.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    });

    it('defines the same properties in both themes, plus color-scheme', () => {
      expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
      expect(lightRe.exec(css)![1]).toContain('color-scheme: light');
      expect(darkRe.exec(css)![1]).toContain('color-scheme: dark');
    });

    it('keeps the original light values', () => {
      expect(light).toEqual({
        '--bg': '#ffffff',
        '--text': '#1a1a1a',
        '--text-muted': '#4b5563',
        '--text-form-note': '#374151',
        '--border': '#d1d5db',
        '--border-strong': '#4b5563',
        '--border-empty': '#6b7280',
        '--primary': '#1d4ed8',
        '--on-primary': '#ffffff',
        '--secondary-bg': '#ffffff',
        '--input-bg': '#ffffff',
        '--disabled-bg': '#e5e7eb',
        '--disabled-border': '#d1d5db',
        '--disabled-text': '#4b5563',
        '--badge-draft-bg': '#e5e7eb',
        '--badge-draft-fg': '#1f2937',
        '--badge-submitted-bg': '#dbeafe',
        '--badge-submitted-fg': '#1e3a8a',
        '--badge-approved-bg': '#dcfce7',
        '--badge-approved-fg': '#14532d',
        '--badge-rejected-bg': '#fee2e2',
        '--badge-rejected-fg': '#7f1d1d',
        '--error-bg': '#fef2f2',
        '--error-text': '#7f1d1d',
        '--error-border': '#991b1b',
        '--field-error': '#991b1b',
      });
    });

    function luminance(hex: string) {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function contrast(a: string, b: string) {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    }

    const text: [string, string][] = [
      ['--text', '--bg'],
      ['--text-muted', '--bg'],
      ['--text-muted', '--input-bg'],
      ['--text-form-note', '--bg'],
      ['--on-primary', '--primary'],
      ['--primary', '--secondary-bg'],
      ['--text', '--input-bg'],
      ['--disabled-text', '--disabled-bg'],
      ['--badge-draft-fg', '--badge-draft-bg'],
      ['--badge-submitted-fg', '--badge-submitted-bg'],
      ['--badge-approved-fg', '--badge-approved-bg'],
      ['--badge-rejected-fg', '--badge-rejected-bg'],
      ['--error-text', '--error-bg'],
      ['--field-error', '--bg'],
    ];
    const edges: [string, string][] = [
      ['--primary', '--bg'],
      ['--border-strong', '--bg'],
      ['--border-empty', '--bg'],
    ];

    describe.each([
      ['light', light],
      ['dark', dark],
    ])('%s contrast', (_name, p) => {
      it.each(text)('%s on %s is at least 4.5:1', (fg, bg) => {
        expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
      });
      it.each(edges)('%s against %s is at least 3:1', (fg, bg) => {
        expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
