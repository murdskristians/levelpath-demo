# Plan: Light/dark theme toggle

> Spec: agents/8e469b6a/spec.md · Type: feature

## Approach

Replace every hex in `App.css` with a custom property. `:root` holds the light values (today's hex, unchanged). `:root[data-theme='dark']` overrides them. A small `theme.ts` module reads and writes the choice (`levelpath.theme`), and a `ThemeToggle` button flips it. An inline script in `index.html` sets `data-theme` before first paint, using the same rule as `theme.ts`.

The alternative is a pure CSS `@media (prefers-color-scheme: dark)` block. It cannot hold a user override, so the attribute is needed anyway. One mechanism is simpler than two.

## Libraries and versions

None. React 19, Vite, Vitest, Testing Library and jsdom are already in `apps/web`; nothing is added. The contrast helper in the test is about 15 lines of plain code (WCAG relative luminance).

## Files

- `apps/web/src/App.css` — hex values become `var(--…)`; add the two palette blocks and `.theme-toggle`.
- `apps/web/src/App.tsx` — hold `theme` state, apply it to `<html>`, render `ThemeToggle` next to the picker.
- `apps/web/index.html` — inline no-flash script in `<head>`.
- `docs/LEARNING.md` — a short entry: theme through a `data-theme` attribute plus custom properties, and why the inline script exists.
- `CLAUDE.md` — one line in the `apps/web` Architecture bullet: theme in `src/theme.ts`, `levelpath.theme` key.

### New files

- `apps/web/src/theme.ts` — `Theme` type, `THEME_KEY`, `loadTheme()`, `saveTheme()`, `applyTheme()`.
- `apps/web/src/components/ThemeToggle.tsx` — the button.
- `apps/web/src/theme.test.tsx` — the tests listed below.

## Steps

### 1. Theme module

`theme.ts`:

- `loadTheme(): Theme`. Read `localStorage.getItem('levelpath.theme')`. Return it when it is `light` or `dark`. Otherwise return `matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`. Guard `window.matchMedia` being undefined (jsdom) and return `light`.
- If `getItem` throws, `console.warn` once and fall back to the OS value.
- `saveTheme(t)`: `setItem`. On a throw, `console.warn` and continue, so the toggle still works for the session.
- `applyTheme(t)`: `document.documentElement.dataset.theme = t`.

Follow the shape of `users.ts`.

### 2. Toggle and wiring

- `ThemeToggle({ theme, onToggle })` renders `<button type="button" className="theme-toggle" onClick={onToggle}>` with the visible text `Switch to dark theme` or `Switch to light theme`. The accessible name is that text, with no `aria-label`.
- In `App`: `const [theme, setTheme] = useState<Theme>(loadTheme)`. `useLayoutEffect(() => applyTheme(theme), [theme])`. The toggle handler computes the next theme, calls `saveTheme(next)` and `setTheme(next)`.
- `App` owns the state (not `Dashboard`), so the `key={userId}` remount does not reset it. Build `const picker = <><UserPicker …/><ThemeToggle …/></>`; both header branches already render `picker`, which satisfies criterion 5. Check the markup does not break the header layout. The `.user-picker` is a flex column, and the button sits below it.

### 3. No-flash script

In `index.html` `<head>`, before the module script, add an inline script, an IIFE:

```js
(function () {
  var t = null;
  try {
    t = localStorage.getItem('levelpath.theme');
  } catch (e) {
    console.warn('levelpath: theme storage unavailable', e);
  }
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = t;
})();
```

Vite keeps inline classic scripts in place. Because it runs in `<head>` before the body, the attribute is set before first paint. The CSS, bundled as a module import, applies after the attribute is set. The stylesheet's `:root` default is light, so a no-JS browser still gets the light page.

### 4. CSS

Define the light block with these original values, then replace each hex:

| Variable                              | Light (today)         | Dark                  |
| ------------------------------------- | --------------------- | --------------------- |
| `--bg`                                | `#ffffff`             | `#0f172a`             |
| `--text`                              | `#1a1a1a`             | `#e5e7eb`             |
| `--muted` (footer, `.note`)           | `#4b5563`             | `#cbd5e1`             |
| `--form-note`                         | `#374151`             | `#cbd5e1`             |
| `--border` (header, list items)       | `#d1d5db`             | `#475569`             |
| `--empty-border`                      | `#6b7280`             | `#94a3b8`             |
| `--input-bg`                          | `#ffffff`             | `#1e293b`             |
| `--input-border`                      | `#4b5563`             | `#94a3b8`             |
| `--accent` (button bg and border)     | `#1d4ed8`             | `#60a5fa`             |
| `--on-accent`                         | `#ffffff`             | `#0f172a`             |
| `--focus`                             | `#1d4ed8`             | `#93c5fd`             |
| `--secondary-bg`                      | `#ffffff`             | `#1e293b`             |
| `--secondary-text`                    | `#1d4ed8`             | `#93c5fd`             |
| `--disabled-bg`                       | `#e5e7eb`             | `#1e293b`             |
| `--disabled-border`                   | `#d1d5db`             | `#475569`             |
| `--disabled-text`                     | `#4b5563`             | `#9ca3af`             |
| `--draft-bg` / `--draft-text`         | `#e5e7eb` / `#1f2937` | `#374151` / `#f3f4f6` |
| `--submitted-bg` / `--submitted-text` | `#dbeafe` / `#1e3a8a` | `#1e3a8a` / `#dbeafe` |
| `--approved-bg` / `--approved-text`   | `#dcfce7` / `#14532d` | `#14532d` / `#dcfce7` |
| `--rejected-bg` / `--rejected-text`   | `#fee2e2` / `#7f1d1d` | `#7f1d1d` / `#fee2e2` |
| `--error-bg`                          | `#fef2f2`             | `#450a0a`             |
| `--error-text`                        | `#7f1d1d`             | `#fecaca`             |
| `--error-border`                      | `#991b1b`             | `#f87171`             |
| `--field-error`                       | `#991b1b`             | `#fca5a5`             |
| `--tag-bg` / `--tag-text`             | `#dbeafe` / `#1e3a8a` | `#1e3a8a` / `#dbeafe` |

- Set `color-scheme: light` on `:root` and `color-scheme: dark` on the dark block.
- Reuse `--accent` for the button border. `button.secondary` keeps the accent border.
- Add `.theme-toggle { margin-top: 0.5rem; }`. It keeps the existing button look otherwise.
- The dark values were estimated by hand. If the contrast test fails on a pair, change that dark value (not the test, not the light value) until it passes.

### 5. Tests (`theme.test.tsx`, plus a `matchMedia` stub helper)

See Tests. Stub `window.matchMedia` with `vi.stubGlobal` or `Object.defineProperty`, and reset `document.documentElement.dataset.theme` and `localStorage` in `afterEach`. Reuse `mockFetch`, `me` and `supplier` from `src/test/fixtures.ts` and the `renderAs` pattern from `App.test.tsx`. Don't edit existing tests: `App.test.tsx` has no `matchMedia`, so `loadTheme` must tolerate its absence.

### 6. Docs

Update `docs/LEARNING.md` and the `CLAUDE.md` line above.

### 7. Validate

Run the validation commands below.

## Tests

- OS default (dark/light/no `matchMedia`), stored value beating the OS in both directions, an invalid stored value (criteria 1 to 3).
- Toggle: name, `data-theme`, stored value and renaming, both directions (criterion 4). The toggle is in the header with and without a user (criterion 5).
- Persistence over a user switch (`fireEvent.change` on the picker) and over a re-render (criterion 6).
- `localStorage.getItem` throwing in `loadTheme`: falls back to the OS and warns. `setItem` throwing: the toggle still flips the attribute.
- `index.html` script: read the file, extract the contents of the first inline `<script>` without `src`, run it with `new Function` against jsdom in the four cases, and with a throwing `Storage.prototype.getItem` (criterion 7).
- CSS: no hex outside the two palette blocks (criterion 8). Parse the variables from both blocks, check the light values against the table above, and check the WCAG ratios for the pairs in criterion 9: text 4.5:1 for `--text`/`--bg`, `--muted`/`--bg`, `--form-note`/`--bg`, `--on-accent`/`--accent`, `--secondary-text`/`--secondary-bg`, each badge pair, `--error-text`/`--error-bg`, `--field-error`/`--bg`, `--tag-text`/`--tag-bg`, `--text`/`--input-bg`, `--disabled-text`/`--disabled-bg`. Check 3:1 for `--input-border`/`--bg`, `--focus`/`--bg`, `--accent`/`--bg`, `--empty-border`/`--bg`. In the light theme, `--disabled-text` and the decorative `--border` are measured and may sit below the bar only where the original values do. Skip those pairs rather than change a light value. No tenant data is touched, so there is no RLS test.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

Then run the app on chosen ports (`API_PORT=<a> pnpm --filter @levelpath/api dev`, `pnpm --filter @levelpath/web dev --port <w> --strictPort`) and walk criterion 10. Stop both with `factory/bin/port stop <port>`.

## Notes

- Run `pnpm exec prettier --write` on the touched files before the gate; lint only checks.
- The light values equal the original hex values, so light mode must not change visually. Compare it to `main` on the same screens.
- `factory/checks.sh` and the other protected paths are not touched.
