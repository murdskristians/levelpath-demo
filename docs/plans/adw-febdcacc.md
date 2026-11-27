# Plan: Light/dark theme toggle

> Spec: agents/febdcacc/spec.md · Type: feature

## Approach

Replace each hex color in `App.css` with a custom property. `:root` holds the light values (today's colors) and `[data-theme='dark']` overrides them. A tiny inline script in `index.html` sets `data-theme` on `<html>` before first paint. A small `theme.ts` module holds the same rule for React (stored choice, otherwise OS) and writes the choice. `App` owns the theme state and renders a `ThemeToggle` beside the `UserPicker` in both header variants. This beats a `@media (prefers-color-scheme)` block alone, because the user's choice must override the OS.

## Libraries and versions

None. No new dependency. Existing: React 19, Vitest 5 and Testing Library 16 (`apps/web/package.json`). jsdom has no `matchMedia`, so tests stub `window.matchMedia`.

## Dark palette

| Variable              | Light (today)       | Dark                |
| --------------------- | ------------------- | ------------------- |
| `--bg`                | `#ffffff`           | `#121417`           |
| `--text`              | `#1a1a1a`           | `#e5e7eb`           |
| `--text-muted`        | `#4b5563`           | `#aab2bf`           |
| `--text-note`         | `#374151`           | `#d1d5db`           |
| `--border`            | `#d1d5db`           | `#3f4652`           |
| `--border-strong`     | `#4b5563`           | `#9ca3af`           |
| `--empty-border`      | `#6b7280`           | `#9ca3af`           |
| `--primary`           | `#1d4ed8`           | `#60a5fa`           |
| `--on-primary`        | `#ffffff`           | `#0b1220`           |
| `--disabled-bg`       | `#e5e7eb`           | `#272b33`           |
| `--disabled-border`   | `#d1d5db`           | `#3f4652`           |
| `--disabled-text`     | `#4b5563`           | `#9ca3af`           |
| `--secondary-bg`      | `#ffffff`           | `#121417`           |
| `--secondary-text`    | `#1d4ed8`           | `#93c5fd`           |
| `--input-bg`          | `#ffffff`           | `#1b1f24`           |
| `--focus`             | `#1d4ed8`           | `#93c5fd`           |
| `--badge-draft-bg`    | `#e5e7eb`           | `#374151`           |
| `--badge-draft-fg`    | `#1f2937`           | `#f3f4f6`           |
| `--badge-sub-bg`      | `#dbeafe`           | `#1e3a8a`           |
| `--badge-sub-fg`      | `#1e3a8a`           | `#dbeafe`           |
| `--badge-ok-bg`       | `#dcfce7`           | `#14532d`           |
| `--badge-ok-fg`       | `#14532d`           | `#dcfce7`           |
| `--badge-no-bg`       | `#fee2e2`           | `#7f1d1d`           |
| `--badge-no-fg`       | `#7f1d1d`           | `#fee2e2`           |
| `--error-bg`          | `#fef2f2`           | `#3b1214`           |
| `--error-text`        | `#7f1d1d`           | `#fecaca`           |
| `--error-border`      | `#991b1b`           | `#f87171`           |
| `--field-error`       | `#991b1b`           | `#fca5a5`           |
| `--tag-bg`/`--tag-fg` | `#dbeafe`/`#1e3a8a` | `#1e3a8a`/`#dbeafe` |

Contrast pairs the test asserts (min 4.5 for text, 3 for non-text): `--text` on `--bg`; `--text-muted` on `--bg`; `--text-note` on `--bg`; `--on-primary` on `--primary`; `--disabled-text` on `--disabled-bg`; `--secondary-text` on `--secondary-bg`; `--text` on `--input-bg`; each badge fg on its bg; `--error-text` on `--error-bg`; `--field-error` on `--bg`; `--border-strong` on `--bg` (3); `--empty-border` on `--bg` (3); `--focus` on `--bg` (3). The builder checks the dark values by running the test and adjusts a value only if a pair fails, never a light value.

## Files

- `apps/web/src/App.css` — variables in `:root` and `[data-theme='dark']` (plus `color-scheme`), every rule uses `var(--…)`, and a `.theme-toggle` rule.
- `apps/web/index.html` — inline theme script in `<head>`.
- `apps/web/src/App.tsx` — theme state, toggle beside the picker in both header branches.
- `apps/web/src/App.test.tsx` — only if an existing test needs the `matchMedia` stub (jsdom lacks it). `theme.ts` guards `typeof window.matchMedia === 'function'`, so existing tests should need no change.

### New files

- `apps/web/src/theme.ts` — `Theme`, `THEME_KEY`, `loadTheme`, `saveTheme`, `systemTheme`, `initialTheme`, `applyTheme`.
- `apps/web/src/components/ThemeToggle.tsx` — the button.
- `apps/web/src/theme.test.ts` — unit tests, the inline script test, the contrast test and the hex-only-in-variables check.
- `apps/web/src/components/ThemeToggle.test.tsx` — or the App-level tests in `src/theme.app.test.tsx`; the builder picks one file for the criteria 1-7 tests.

## Steps

### 1. `theme.ts`

```ts
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'levelpath.theme';

export function systemTheme(): Theme {
  const dark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

/** The stored choice, or null when none or invalid. A storage failure is logged. */
export function loadTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch (err) {
    console.warn('levelpath: could not read the stored theme', err);
    return null;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    console.warn('levelpath: could not store the theme', err);
  }
}

export const initialTheme = (): Theme => loadTheme() ?? systemTheme();

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
```

Saving a failed write is not rethrown: the theme still applies for this page, and the warning is the typed fallback.

### 2. `ThemeToggle.tsx`

```tsx
import type { Theme } from '../theme';

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="secondary theme-toggle" onClick={onToggle}>
      {`Switch to ${next} theme`}
    </button>
  );
}
```

### 3. `App.tsx`

In `App`: `const [theme, setTheme] = useState<Theme>(initialTheme);`, then `useEffect(() => applyTheme(theme), [theme]);`. `toggle` calls `const next = theme === 'dark' ? 'light' : 'dark'; saveTheme(next); setTheme(next);`. Nothing is stored until the first press, so the OS default stays in force. Build `const picker = (<><UserPicker …/><ThemeToggle theme={theme} onToggle={toggle} /></>);`. Both header branches already render `picker`, so no `Dashboard` change is needed. Keeping it one node means a user switch (Dashboard is keyed) does not touch the theme.

### 4. `index.html` inline script

In `<head>`, after the viewport meta:

```html
<script>
  (function () {
    var theme;
    try {
      var stored = localStorage.getItem('levelpath.theme');
      if (stored === 'light' || stored === 'dark') theme = stored;
    } catch (err) {
      console.warn('levelpath: could not read the stored theme', err);
    }
    if (!theme) {
      theme =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
```

### 5. `App.css`

Add the two variable blocks from the palette table at the top, with `color-scheme: light` and `color-scheme: dark`. Then replace every hex with its variable. Map each rule to a variable by its old hex, as in the table, and keep every other property as it is. Add `.theme-toggle { margin-top: 0.5rem; }`. In the existing mobile `button { width: 100% }` media query nothing changes. `button.secondary` uses `--secondary-bg`, `--secondary-text` and `border-color` stays `--primary`. Do not change layout, spacing or the light values.

### 6. Tests

`matchMedia` stub helper: `vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} }))`. Cover spec criteria 1-12:

- OS dark and OS light defaults, with the button name each time.
- A click flips `data-theme`, the button name and the stored value.
- A stored choice beats the OS, in both directions. A garbage stored value is ignored.
- Switching the picker user keeps theme and storage (use `mockFetch` and `base`-style routes from `App.test.tsx`).
- The toggle is in the header with no user and with a user.
- A `localStorage` that throws (`vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('x'); })`) still renders and warns. Spy on `console.warn`.
- The inline script: read `index.html`, extract the `<script>` body with a regex, run it with `new Function(body)()` under each case, and assert `data-theme`. Reset `document.documentElement` and storage in `afterEach`.
- The contrast test: parse the variable blocks out of `App.css` (read with `node:fs`, as `App.test.tsx` already does), compute WCAG ratios and assert the pairs above.
- The hex check: strip the two variable blocks from the CSS text and assert no `#[0-9a-fA-F]{3,8}` remains.
- Clean up in `afterEach`: `localStorage.clear()`, `delete document.documentElement.dataset.theme`, `vi.unstubAllGlobals()`, `vi.restoreAllMocks()`.

### 7. Docs

- `docs/LEARNING.md`: a short entry on the theme approach: CSS custom properties, a `data-theme` attribute set by an inline script to avoid a flash, and a per-browser choice that overrides the OS.
- `CLAUDE.md`: in the `apps/web` Architecture line, add "light/dark theme via CSS variables and `data-theme`, choice in `localStorage` (`levelpath.theme`)".

### 8. Validate

Run the validation commands below.

## Tests

See step 6. No data access changes, so no tenant isolation test applies.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

Also run the app on chosen ports (`pnpm --filter @levelpath/web dev --port <w> --strictPort`, with `API_PORT=<a>` and the API as in CLAUDE.md). Check, light and dark:

- With the OS set to dark, the first load is dark.
- The button flips the theme, and a reload keeps it.
- Switching users keeps it.
- The new-request form, the Suggest fields, an error alert, an empty state and a disabled button all read well.

Stop with `factory/bin/port stop <port>`.

## Notes

- Run `pnpm lint` (Prettier, check only) on the new HTML: Prettier may reformat the inline script, which is fine as long as the content is the same.
- If Prettier ignores `index.html`, no action is needed.
- The `catch` in the inline script logs with `console.warn`, in line with CLAUDE.md.
- Light values stay byte-for-byte equal to the old hexes. `--bg` is `#ffffff`, `--text` is `#1a1a1a`.
- Two old hex values are shared by different roles (`#4b5563` is muted text, input border and disabled text; `#1d4ed8` is primary, focus and secondary text), so they get separate variables, as in the table.
- Do not log or write to `docs/HARNESS_CHANGELOG.md` unless a mistake is corrected during the build.
