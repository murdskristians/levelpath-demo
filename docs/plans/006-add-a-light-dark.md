# Plan: Light/dark theme toggle in the header

> Spec: factory/jobs/006-add-a-light-dark/spec.md · Type: feature

## Approach

Replace every hex in `App.css` with a custom property defined on `:root` (light, same values as today) and overridden under `:root[data-theme='dark']`. A tiny `theme.ts` module resolves/stores/applies the theme; `App` owns the state (outside the keyed `Dashboard`) and renders a `ThemeToggle` next to the picker in both header states. An inline script in `index.html` sets `data-theme` before first paint, because the module bundle runs after first paint and would flash. The alternative of duplicating the dark palette inside a `@media (prefers-color-scheme: dark)` block was rejected: the palette would exist twice. The inline script duplicates a few lines of logic, which a test keeps in step with `theme.ts`.

## Libraries and versions

None. Plain CSS, React 19 and Vitest 5.1 (`pnpm view vitest version` gives 5.1.2) already in `apps/web`. No new dependency.

## Files

- `apps/web/src/App.css` — hex values become `var(--…)`; add the two palette blocks; `.theme-toggle` styles.
- `apps/web/index.html` — inline theme script in `<head>`.
- `apps/web/src/App.tsx` — theme state in `App`; put `ThemeToggle` beside `UserPicker` in the shared `picker` element (used by both headers).
- `apps/web/src/App.test.tsx` — only if an existing assertion breaks because of the extra button (e.g. a count of buttons); adjust the query, not the intent.
- `CLAUDE.md`, `docs/LEARNING.md` — doc updates (see step 5).

### New files

- `apps/web/src/theme.ts` — `THEME_KEY = 'levelpath.theme'`, `type Theme`, `resolveTheme()`, `applyTheme(theme)`, `saveTheme(theme)`.
- `apps/web/src/components/ThemeToggle.tsx` — the button.
- `apps/web/src/theme.test.ts` — unit tests for the module, the inline script, the CSS checks.
- `apps/web/src/components/ThemeToggle.test.tsx` — optional; App-level tests may carry it instead.

## Steps

### 1. Palette in CSS

Custom properties (light = today's value, dark = new). Light hex values must be copied exactly from the current `App.css`.

| Property | Light | Dark | Used by |
| --- | --- | --- | --- |
| `--bg` | #ffffff | #121212 | body background |
| `--text` | #1a1a1a | #e5e7eb | body, input text |
| `--text-muted` | #4b5563 | #9ca3af | footer, `.note` |
| `--text-form-note` | #374151 | #d1d5db | `.form-note` |
| `--border` | #d1d5db | #4b5563 | header, request list items |
| `--border-strong` | #4b5563 | #9ca3af | inputs, selects, textareas |
| `--border-empty` | #6b7280 | #9ca3af | `.empty-state` |
| `--primary` | #1d4ed8 | #60a5fa | button bg and border, focus outline, secondary text |
| `--on-primary` | #ffffff | #0b1220 | button text |
| `--secondary-bg` | #ffffff | #121212 | `button.secondary` |
| `--input-bg` | #ffffff | #1e1e1e | inputs |
| `--disabled-bg` | #e5e7eb | #1f2937 | `button:disabled` |
| `--disabled-border` | #d1d5db | #374151 | `button:disabled` |
| `--disabled-text` | #4b5563 | #9ca3af | `button:disabled` |
| `--badge-draft-bg` / `-fg` | #e5e7eb / #1f2937 | #374151 / #f3f4f6 | `.badge-draft` |
| `--badge-submitted-bg` / `-fg` | #dbeafe / #1e3a8a | #1e3a8a / #dbeafe | `.badge-submitted`, `.suggested-tag` |
| `--badge-approved-bg` / `-fg` | #dcfce7 / #14532d | #14532d / #dcfce7 | `.badge-approved` |
| `--badge-rejected-bg` / `-fg` | #fee2e2 / #7f1d1d | #7f1d1d / #fee2e2 | `.badge-rejected` |
| `--error-bg` | #fef2f2 | #450a0a | `.error-alert` |
| `--error-text` | #7f1d1d | #fecaca | `.error-alert` |
| `--error-border` | #991b1b | #f87171 | `.error-alert` border |
| `--field-error` | #991b1b | #fca5a5 | `.field-error` |

Expected contrast (computed from WCAG relative luminance, the contrast test confirms): dark text on bg about 14:1, muted on bg about 7:1, on-primary on primary about 7:1, primary on bg about 7:1, disabled text on disabled bg about 5.8:1, badge and error pairs 7:1 or better, borders/focus vs bg 3:1 or better (`--border` is decorative and exempt, `--border-strong`, `--border-empty` and `--primary` are checked at 3:1).

Add `color-scheme: light` on `:root` and `color-scheme: dark` in the dark block. Add `.theme-toggle { margin-top: 0 }` and keep the mobile `width: 100%` rule applying. Existing selectors and layout stay as they are. The `.suggested-tag` reuses the submitted properties. Do not add transitions.

### 2. Theme module and inline script

- `theme.ts`: `resolveTheme()` per requirement 4, every storage and `matchMedia` access in try/catch (a catch returns the fallback; logging not needed because the failure is an expected environment condition, add a one-line comment saying so), and `typeof window.matchMedia === 'function'` guard. `applyTheme` sets `document.documentElement.dataset.theme`. `saveTheme` writes in try/catch (a catch is a comment-only no-op by design: a storage that refuses writes must not break the switch).
- `index.html`: inline `<script>` before the module script, same logic as `resolveTheme`, wrapped in try/catch, setting `document.documentElement.setAttribute('data-theme', t)`. Use no `const`-free tricks: plain ES5-ish function is fine.
- `ThemeToggle.tsx`: props `{ theme, onToggle }`; `<button type="button" className="theme-toggle" onClick={onToggle}>` with text `Switch to dark theme` when `theme === 'light'`, else `Switch to light theme`.
- `App.tsx`: `const [theme, setTheme] = useState<Theme>(() => { const t = resolveTheme(); applyTheme(t); return t; })` (so the attribute is right even when the inline script did not run, e.g. in tests). `toggle` computes the next theme, calls `applyTheme`, `saveTheme`, `setTheme`. Change `picker` to a fragment containing `UserPicker` then `ThemeToggle`. `Dashboard`'s props are unchanged.

### 3. Tests (in the same change)

`theme.test.ts` and `App.test.tsx` additions, using a small helper that stubs `window.matchMedia` with `vi.stubGlobal` / `Object.defineProperty` (jsdom has none) and removes `data-theme` in `afterEach`:

- Spec criteria 1 to 6: OS default both ways, toggle click and storage, stored beats OS both ways, nothing written without a click, invalid and throwing storage and missing `matchMedia`, theme survives a user switch, toggle present with no user.
- Criterion 7: read `index.html` with `node:fs`, extract the text of the inline `<script>` (no `src`), run it with `new Function('localStorage', 'matchMedia', 'document', code)`-style injection or by temporarily setting globals, for the five cases.
- Criterion 8: read `App.css` as text; split out the `:root { … }` and `:root[data-theme='dark'] { … }` blocks; assert no `#[0-9a-f]{3,8}` outside them; same property names in both; the light block contains each light hex from the table above.
- Criterion 9: parse both blocks into maps and assert ratios (small `contrast(a, b)` helper in the test): `--text`/`--bg`, `--text-muted`/`--bg`, `--text-muted`/`--input-bg`, `--text-form-note`/`--bg`, `--on-primary`/`--primary`, `--primary`/`--secondary-bg`, `--text`/`--input-bg`, `--disabled-text`/`--disabled-bg`, each badge fg/bg, `--error-text`/`--error-bg`, `--field-error`/`--bg`, `--primary`/`--bg` (3:1 as border/outline), `--border-strong`/`--bg` (3:1), `--border-empty`/`--bg` (3:1). If a light pair fails, do not change the light value: relax only that light pair in the test with a comment and note it in the PR.
- If an existing test breaks because of the extra button, fix its query, nothing else.

### 4. Check in a browser

Start the API and web on chosen ports (see `CLAUDE.md`), emulate OS dark mode, and walk the Verification list in spec criterion 10. Stop with `factory/bin/port stop <port>`.

### 5. Docs

- `CLAUDE.md` Architecture, `apps/web` line: add "theme: `data-theme` on `<html>` set by an inline script in `index.html` and `src/theme.ts`; colors are custom properties in `App.css`".
- `docs/LEARNING.md`: a short entry on why theme is set by an inline script before first paint and why the state lives above the keyed `Dashboard`.

### 6. Validate

Run the validation commands below.

## Tests

As in step 3. Tenant isolation: no data access is added, so no RLS test applies.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

Plus `git diff --stat origin/main` to confirm only `apps/web`, `docs` and `CLAUDE.md` changed, and the browser walk-through in step 4. `pnpm lint` is Prettier check only: run `pnpm exec prettier --write` on the changed files before it.

## Notes

- The mobile rule `button { width: 100% }` also hits the toggle; that is fine.
- The OS preference is not watched live; a reload picks up a changed OS setting when nothing is stored.
- `index.html` needs no CSP change; there is none.
