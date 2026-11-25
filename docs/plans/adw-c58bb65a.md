# Plan: Light/dark theme toggle

> Spec: agents/c58bb65a/spec.md · Type: feature

## Approach

Turn every color in `App.css` into a CSS custom property. The light values go in `:root` (identical to today's hex values). The dark values go in `:root[data-theme='dark']`. A `data-theme` attribute on `<html>` picks the theme. A small inline script in `index.html` sets it before first paint from `localStorage` or `prefers-color-scheme`. A tiny `theme.ts` module holds the same rule for React: it reads the current theme, toggles it and stores it. A `ThemeToggle` component renders the button in both header branches. Plain CSS and one small module avoid a theme library and a context provider, which a single attribute doesn't need.

## Libraries and versions

None new. The existing React 19, Vite, Vitest 5 and Testing Library in `apps/web` are enough. The contrast test is plain TypeScript (the WCAG relative-luminance formula), no package.

## Files

- `apps/web/src/App.css`: replace hex values with `var(--…)`; add the two theme blocks.
- `apps/web/index.html`: inline no-flash script in `<head>`.
- `apps/web/src/App.tsx`: render `<ThemeToggle />` inside both `<header>` variants (via the `picker` node or beside it).
- `docs/LEARNING.md`: a short entry on theme tokens and the pre-paint script.

### New files

- `apps/web/src/theme.ts`: `THEME_KEY = 'levelpath.theme'`, `type Theme`, `loadStoredTheme()`, `systemTheme()`, `currentTheme()`, `applyTheme(theme)` (sets `data-theme` on `<html>`), `saveTheme(theme)`. Every storage or `matchMedia` access sits in a try/catch that logs with `console.warn` and falls back to light (never silent).
- `apps/web/src/components/ThemeToggle.tsx`: the button.
- `apps/web/src/theme.test.tsx`: toggle, stored choice, OS default, user switch, both headers, inline script, contrast tests.

## Steps

### 1. Tokens in the stylesheet

- Read `App.css` whole. Give each color a role-named variable, for example `--bg`, `--text`, `--text-muted`, `--border`, `--border-strong`, `--primary`, `--primary-text`, `--focus`, `--disabled-bg`, `--disabled-border`, `--disabled-text`, `--badge-*-bg` / `--badge-*-text`, `--error-bg`, `--error-border`, `--error-text`, `--tag-bg`, `--tag-text`.
- `:root` holds the light values taken from today's rules (for example `#1a1a1a`, `#ffffff`, `#4b5563`, `#1d4ed8`). Where one hex plays two roles today (for example `#4b5563` as muted text and as input border), keep the two roles as separate variables with the same light value, so dark can differ.
- `:root[data-theme='dark']` holds the palette from the spec. Set `color-scheme: light` and `color-scheme: dark` in the matching blocks.
- Add `.theme-toggle` (spacing only). Keep `input, select, textarea { width: 100% }` as it is, since the existing `styles` tests match it.

### 2. Theme module and button

- Write `theme.ts` as in Files. The rule: stored `light` or `dark` wins, otherwise `matchMedia('(prefers-color-scheme: dark)').matches`, otherwise light. Ignore any other stored value.
- `ThemeToggle` keeps the theme in state, initialised from `currentTheme()` (the attribute the inline script set, falling back to the rule). On click it computes the other theme, calls `applyTheme` and `saveTheme`. The `aria-label` is `Switch to dark theme` or `Switch to light theme`; the visible text is `Dark theme` or `Light theme`. `type="button"`.
- Also call `applyTheme(currentTheme())` once on mount so tests and a missing script still get an attribute.
- In `App.tsx`, render the toggle in both headers. Because `picker` is already shared, wrap it: `const picker = <><UserPicker …/><ThemeToggle /></>`. The toggle sits outside `Dashboard`'s key, so switching users doesn't remount it. Note that the toggle is inside `picker`, which `Dashboard` receives as a prop and renders in its header.

### 3. No-flash script

- Add to `<head>`, before the module script, an inline IIFE with the same rule as `theme.ts` (try/catch, falls back to light), setting `document.documentElement.dataset.theme`. Keep it under about 10 lines. Vite keeps inline scripts as they are.

### 4. Tests (`theme.test.tsx`)

- Stub `window.matchMedia` per test (jsdom has none). Clear `localStorage` and the `data-theme` attribute after each test. Use the `mockFetch`, `me` and `supplier` fixtures from `src/test/fixtures.ts` as `App.test.tsx` does.
- Cover spec criteria 2 to 7: OS default (both), toggle both ways with the stored value and the accessible name, stored value beating the OS (both ways), invalid stored value ignored, survival across a user switch and a remount, toggle present in the banner with and without a user, and the inline script run with `new Function` against stubbed `localStorage` and `matchMedia` (including a throwing `localStorage`). Read the script text from `index.html` with `readFileSync('index.html')` and a regex.
- Contrast test: parse the two blocks from `App.css` with a regex into variable maps, compute the WCAG ratio, assert the pairs in criterion 8. If a pair fails, change the value in the dark block, not the test. A light-theme failure on an unchanged color is not fixed (the light look must not change): list such a pair as an explicit exclusion with a comment. Today's light colors already pass as far as I can tell, but the builder must check.
- A test that the CSS has no hex outside the two theme blocks (criterion 9).

### 5. Docs

- Add the `docs/LEARNING.md` entry. If anything is corrected along the way, log it in `docs/HARNESS_CHANGELOG.md`.

### 6. Validate

Run the validation commands below.

## Tests

- All in `apps/web/src/theme.test.tsx` as above. No tenant data is touched, so there is no tenant-isolation test; the API is unchanged.
- Existing tests, especially the `styles` block in `App.test.tsx`, pass unedited.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

Then, on chosen ports: `API_PORT=<a> pnpm --filter @levelpath/api dev` and `pnpm --filter @levelpath/web dev --port <w> --strictPort`. Open the page as an approver. Press the toggle and check every screen in both themes. Reload and check there is no flash (also with the OS in dark mode and nothing stored). Stop with `factory/bin/port stop <port>`.

## Notes

- Don't touch protected paths (`factory/*`, `REVIEW.md`, `.claude/hooks/*`).
- Don't edit tests to pass: fix the code or the dark values.
- Prettier is checked by `pnpm lint`; run it on the new files before finishing.
- The theme is read once on load; it does not listen for OS changes (out of scope).
