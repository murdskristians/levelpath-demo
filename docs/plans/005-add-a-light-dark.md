# Plan: Light/dark theme toggle

> Spec: factory/jobs/005-add-a-light-dark/spec.md · Type: feature

## Approach

Replace every hex in `App.css` with a custom property; `:root` holds the light values (identical to today), `:root[data-theme='dark']` overrides them. A tiny `theme.ts` resolves the theme (stored choice, else OS, else light) and applies it to `<html>`. An inline script in `index.html` does the same before first paint, so there is no flash. `App` owns the theme state, so it survives the `key={userId}` remount of `Dashboard`, and passes a `ThemeToggle` into the same `picker` slot as `UserPicker`. Chosen over a React-only approach because React renders after first paint (flash), and over a context/provider because one `useState` in `App` is enough.

## Libraries and versions

None. No new dependency (plain CSS, React 19.3 and Vitest 5.1 already in `apps/web/package.json`).

## Files

- `apps/web/src/App.css` — hex values become `var(--…)`; add the two palette blocks; style `.header-controls` and `.theme-toggle`.
- `apps/web/index.html` — inline pre-paint script.
- `apps/web/src/App.tsx` — theme state in `App`, `ThemeToggle` rendered beside the picker in both headers.
- `apps/web/src/App.test.tsx` — toggle tests (or put them in the new test file below if cleaner).
- `docs/LEARNING.md` — short entry: pre-paint theme script and custom properties.

### New files

- `apps/web/src/theme.ts` — `THEME_KEY = 'levelpath.theme'`, `type Theme`, `resolveTheme()`, `applyTheme(theme)`, `saveTheme(theme)`.
- `apps/web/src/components/ThemeToggle.tsx` — the button.
- `apps/web/src/theme.test.ts` — helper and inline-script tests.

## Steps

### 1. Palette in `App.css`

Declare these on `:root` (light = today's values) and override under `:root[data-theme='dark']`; set `color-scheme: light` / `dark`.

| Property                                | Light (unchanged)                 | Dark                              | Use                                                  |
| --------------------------------------- | --------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `--bg`                                  | `#ffffff`                         | `#0f1115`                         | page, secondary button bg                            |
| `--text`                                | `#1a1a1a`                         | `#e5e7eb`                         | body, inputs                                         |
| `--text-muted`                          | `#4b5563`                         | `#a1a8b3`                         | footer, `.note`                                      |
| `--text-form-note`                      | `#374151`                         | `#d1d5db`                         | `.form-note`                                         |
| `--border`                              | `#d1d5db`                         | `#374151`                         | header, list items (decorative)                      |
| `--border-empty`                        | `#6b7280`                         | `#9ca3af`                         | `.empty-state` dashed border                         |
| `--control-border`                      | `#4b5563`                         | `#8b93a1`                         | input/select/textarea                                |
| `--control-bg`                          | `#ffffff`                         | `#1a1d24`                         | inputs                                               |
| `--primary`                             | `#1d4ed8`                         | `#60a5fa`                         | button bg/border, focus ring (focus dark: `#93c5fd`) |
| `--on-primary`                          | `#ffffff`                         | `#0b1220`                         | button text                                          |
| `--secondary-text`                      | `#1d4ed8`                         | `#93c5fd`                         | `button.secondary` text                              |
| `--disabled-bg` / `-border` / `-text`   | `#e5e7eb` / `#d1d5db` / `#4b5563` | `#1f2430` / `#374151` / `#9ca3af` | `button:disabled`                                    |
| `--focus`                               | `#1d4ed8`                         | `#93c5fd`                         | `:focus-visible`                                     |
| badge draft bg/text                     | `#e5e7eb` / `#1f2937`             | `#374151` / `#f3f4f6`             |                                                      |
| badge submitted & suggested-tag bg/text | `#dbeafe` / `#1e3a8a`             | `#1e3a8a` / `#dbeafe`             |                                                      |
| badge approved bg/text                  | `#dcfce7` / `#14532d`             | `#14532d` / `#dcfce7`             |                                                      |
| badge rejected bg/text                  | `#fee2e2` / `#7f1d1d`             | `#7f1d1d` / `#fee2e2`             |                                                      |
| error bg / border / text                | `#fef2f2` / `#991b1b` / `#7f1d1d` | `#2a1215` / `#f87171` / `#fecaca` | `.error-alert`                                       |
| `--field-error`                         | `#991b1b`                         | `#fca5a5`                         | `.field-error`                                       |

Expected contrast (dark, approximate; the builder confirms each pair with a quick calculation): text on bg ~15:1, muted ~7.5:1, primary button text ~7.6:1, disabled text ~6.4:1, badges ~8.5-9:1, error text ~11:1, field-error ~9:1, control border on bg ~6:1, focus ring ~9:1. All exceed 4.5:1 (text) and 3:1 (UI).

Add `.header-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.75rem; }`, `.header-controls .user-picker { flex: 1 1 16rem; }`, and `.theme-toggle { margin-top: 0; margin-bottom: 0.75rem; }` (button base has `margin-top: 1rem`; the mobile `width: 100%` rule still applies). Light tokens must stay byte-identical to the hex they replace.

### 2. `theme.ts` and `ThemeToggle`

- `resolveTheme()`: read `localStorage.getItem(THEME_KEY)` in a try/catch (return `null` on throw, and on throw log nothing silently: fall through to OS); accept only `light`/`dark`; else `window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`.
- `applyTheme(t)`: `document.documentElement.dataset.theme = t`. `saveTheme(t)`: `localStorage.setItem` in try/catch that `console.error`s (never silent, never throws into the UI).
- `ThemeToggle({ theme, onToggle })`: `<button type="button" className="secondary theme-toggle" onClick={onToggle}>` with an `aria-hidden` icon span and text `Switch to dark theme` / `Switch to light theme` (the accessible name is that text).

### 3. Wire into `App.tsx`

- `const [theme, setTheme] = useState<Theme>(resolveTheme)`; `useLayoutEffect(() => applyTheme(theme), [theme])`.
- `toggle`: compute the next theme, `setTheme(next)`, `saveTheme(next)` (store only on press).
- `picker` becomes `<div className="header-controls"><UserPicker …/><ThemeToggle …/></div>`; it already flows into both headers.

### 4. Inline script in `index.html`

Before the module script, in `<head>`:

```html
<script>
  try {
    var t = localStorage.getItem('levelpath.theme');
    if (t !== 'light' && t !== 'dark') {
      t =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
</script>
```

On a throw the attribute stays unset and the `:root` light values apply. (If `localStorage` throws but matchMedia works, the builder may split the try blocks so the OS preference still applies; keep it small.) Prettier formats `index.html` in `pnpm lint`, so run `pnpm exec prettier --write apps/web/index.html` if lint complains.

### 5. Tests

In `apps/web/src/theme.test.ts` and `App.test.tsx` (stub `window.matchMedia` per test via `vi.stubGlobal`/assignment; the existing `afterEach` clears `localStorage`; also `delete document.documentElement.dataset.theme` in `afterEach`):

- Criteria 1-5 as App tests (OS dark/light default, stored wins both ways, click flips + stores, nothing stored before click, survives user switch, button present in both headers).
- Criterion 6 as `resolveTheme` unit tests (invalid stored value, no `matchMedia`, throwing `getItem`).
- Criterion 7: read `index.html`, extract the inline script, run it with `new Function` against stubbed `localStorage`/`matchMedia`/`document`, assert it agrees with `resolveTheme` for four cases.
- Criterion 8: read `App.css` and assert no hex outside the two palette blocks.

### 6. Docs

Add a `docs/LEARNING.md` entry: custom properties for theming, `data-theme` on `<html>`, and why the pre-paint inline script exists (React renders after first paint).

### 7. Validate

Run the validation commands below, then the manual check in the browser (criteria 10-11).

## Tests

See step 5. No data access, so no tenant-isolation test applies (the change touches no tenant data).

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

Plus: `API_PORT=<a> pnpm --filter @levelpath/api dev` and `pnpm --filter @levelpath/web dev --port <w> --strictPort`; open the page with the OS (or devtools rendering emulation) in dark and in light, confirm no flash, the toggle, the reload and the user switch, and screenshot each screen in dark. Stop with `factory/bin/port stop <port>`.

## Notes

- Do not edit any protected path (`factory/config.json`, `REVIEW.md`, hooks).
- The `button` rule has `margin-top: 1rem`; the toggle overrides it so it aligns with the picker.
- `jsdom` has no `matchMedia`, so `resolveTheme` must guard it (existing tests render `<App />` without stubbing it).
- Do not add a "System" option or any server call.
