# Plan: Light/dark theme toggle

> Spec: factory/jobs/005-add-a-light-dark/spec.md · Type: feature

## Approach

Colours become CSS custom properties; the theme is a `data-theme` attribute on `<html>`. A small `theme.ts` holds the pure logic (read stored value, fall back to system setting, save, apply). `App` keeps the theme in state, and a `ThemeToggle` button is placed in both header variants. An inline script in `index.html` sets the attribute before first paint. Chosen over a `prefers-color-scheme`-only CSS approach because the user's explicit choice must override the system setting.

## Libraries and versions

None. No package is added; uses React 19, Vitest and jsdom already in `apps/web/package.json`. (jsdom lacks `matchMedia`, so the helper guards it and tests stub it with `vi.stubGlobal`/`window.matchMedia`.)

## Files

- `apps/web/src/App.css` — move every hex colour into variables on `:root` (light, same values as today) and `:root[data-theme='dark']`; add `color-scheme`; small header layout rule for the toggle.
- `apps/web/src/App.tsx` — theme state, render `ThemeToggle` in both headers.
- `apps/web/index.html` — inline pre-paint script.
- `docs/LEARNING.md` — short entry: theming with CSS variables, a `data-theme` attribute and a pre-paint script.
- `CLAUDE.md` — one line under Architecture noting `apps/web/src/theme.ts` and the `levelpath.theme` key (only if the architecture list mentions web internals; otherwise skip).

### New files

- `apps/web/src/theme.ts` — `type Theme`, `getInitialTheme()`, `saveTheme()`, `applyTheme()`.
- `apps/web/src/components/ThemeToggle.tsx` — the button.
- `apps/web/src/theme.test.ts` — helper unit tests and the `index.html` check.

## Steps

### 1. Theme helper (`theme.ts`) with tests

- `KEY = 'levelpath.theme'`. `getInitialTheme()`: in `try/catch`, read `localStorage.getItem(KEY)`; return it if `'light'` or `'dark'`. Otherwise return `dark` when `typeof window.matchMedia === 'function'` and `matchMedia('(prefers-color-scheme: dark)').matches`, else `light`. Follow the `users.ts` style. In the catch, fall through to the system setting (no log needed for an expected unavailable storage, but do not leave an empty catch: return the system result explicitly).
- `saveTheme(theme)`: `try { localStorage.setItem } catch (err) { console.warn(...) }`.
- `applyTheme(theme)`: `document.documentElement.dataset.theme = theme`.
- Tests in `theme.test.ts`: stored value wins over matchMedia; invalid stored value uses system; throwing `getItem` and undefined `matchMedia` give `light`; `saveTheme` with throwing `setItem` does not throw.

### 2. Toggle component and wiring

- `ThemeToggle({ theme, onToggle })`: `<button type="button" className="secondary theme-toggle" onClick={onToggle}>` with `aria-label` `Switch to dark theme` / `Switch to light theme` and visible text `Dark` / `Light` (the name is the label, so the visible text should be contained in it: use `Switch to dark theme` as both text and name, simplest).
- In `App`: `const [theme, setTheme] = useState<Theme>(getInitialTheme)`; `useEffect(() => applyTheme(theme), [theme])`; `toggle` sets the other theme and calls `saveTheme` (save only on click, so an unclicked first visit keeps following the system on the next load). Render `<ThemeToggle>` inside `<header>` in the no-user branch and pass it into `Dashboard` next to `picker` (extend the `picker` prop to a node group, or add a `themeToggle: ReactNode` prop) so both headers have exactly one.
- Component tests in `App.test.tsx` (add a `describe('theme')`): criteria 1 to 4. Mock `window.matchMedia` with a helper; in `afterEach` delete the stub, `localStorage.clear()` (already done), and `delete document.documentElement.dataset.theme`. Existing tests do not define `matchMedia`, which the guard handles.

### 3. CSS variables

- Define variables on `:root` (names such as `--bg`, `--text`, `--muted`, `--border`, `--border-strong`, `--primary`, `--on-primary`, `--surface`, `--disabled-bg`, `--disabled-border`, `--focus`, and per-badge `--badge-*-bg/fg`, `--error-bg/fg/border`, `--tag-bg/fg`), with today's hex values. Replace every hex in rules with `var(--…)`. Add `color-scheme: light` on `:root` and `dark` in the dark block.
- Dark block: dark background and surfaces, light text, a lighter primary (e.g. blue-400 range) with dark `--on-primary` or a darker blue that still gives 4.5:1 with white; dark-tinted badges and error alert. Check each pairing for 4.5:1 text contrast; the focus colour must contrast with `--bg`.
- Add `header` layout so the toggle sits beside or under the picker without breaking the 480px layout; the existing `button { margin-top: 1rem }` is acceptable.
- Verify with the grep in criterion 7.

### 4. Pre-paint script

- In `index.html` `<head>`, before the module script, add an inline script: `try { var t = localStorage.getItem('levelpath.theme'); if (t !== 'light' && t !== 'dark') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; document.documentElement.dataset.theme = t; } catch (e) {}`. Keep the rule identical to `getInitialTheme`.
- Add `<meta name="color-scheme" content="light dark">`.
- Add the `index.html` assertion test (criterion 6) in `theme.test.ts`.

### 5. Docs

- Add the `docs/LEARNING.md` entry. Add the `CLAUDE.md` line only if appropriate (see Files).

### 6. Validate

Run the validation commands below, then do the browser check (criterion 8).

## Tests

- `theme.test.ts`: helper edge cases (invalid, throwing storage, no `matchMedia`), `index.html` script presence.
- `App.test.tsx`: system default dark and light, button in both header variants, toggle round trip with accessible name, persistence across remount against an opposing `matchMedia`.
- No tenant data is touched, so no isolation test applies.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
grep -nE '#[0-9a-fA-F]{3,8}\b' apps/web/src/App.css   # only inside the two variable blocks
```

Browser check: `pnpm --filter @levelpath/shared build`, then `API_PORT=<a> pnpm --filter @levelpath/api dev` and `pnpm --filter @levelpath/web dev --port <w> --strictPort`. Toggle, reload, emulate dark scheme with storage cleared; stop with `factory/bin/port stop <port>`.

## Notes

- Run `pnpm lint` check-only; format files with Prettier before the gate (`pnpm exec prettier --write` on the touched files) since lint never fixes.
- The `index.html` script is a deliberate duplicate of `getInitialTheme`; keep both in sync.
- Do not add a live `matchMedia` change listener.
