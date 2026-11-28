# Plan: Light/dark theme toggle

> Spec: C:/dev/LevelPath/levelpath-demo/agents/72430acb/spec.md · Type: feature

## Approach

Move every color in `App.css` to custom properties on `:root` (light = today's values) and override them under `:root[data-theme='dark']`. A small `theme.ts` reads, stores and applies the theme. `App` holds the state and renders a `ThemeToggle` in the header. An inline script in `index.html` applies the theme before paint. This beats a `prefers-color-scheme`-only media query, because the user's stored choice must override the OS.

## Libraries and versions

None new. Uses React 19, Vitest 5, jsdom 31 and Testing Library already in `apps/web/package.json`. No CSS library.

## Files

- `apps/web/src/App.css`: tokens in two blocks; every rule uses `var(--…)`; add `.theme-toggle`.
- `apps/web/src/App.tsx`: theme state, `ThemeToggle` in the picker slot.
- `apps/web/index.html`: inline no-flash script.
- `docs/LEARNING.md`: a short entry.
- `docs/HARNESS_CHANGELOG.md`: only if something is corrected during the run.

### New files

- `apps/web/src/theme.ts`: theme logic.
- `apps/web/src/components/ThemeToggle.tsx`: the button.
- `apps/web/src/theme.test.ts`: logic, contrast and inline-script tests.
- Theme cases in `apps/web/src/App.test.tsx` (existing file, new `describe('theme')`).

## Steps

### 1. Tokens in `App.css`

Add at the top (values from the spec's palette table):

```css
:root {
  color-scheme: light;
  --bg: #ffffff;
  --text: #1a1a1a;
  /* …one token per row of the spec table, light column = today's value… */
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #111827;
  --text: #f3f4f6;
  /* …dark column… */
}
```

Replace each hex in the rest of the file with its token (`border: 2px dashed var(--border-dashed)`, button `background: var(--accent)`, etc.). Several tokens map to the same light hex (for example error border and `--field-error` are both `#991b1b`), so keep separate names where the dark values differ. Add:

```css
.theme-toggle {
  margin-top: 0.5rem;
}
.theme-toggle[aria-label]::before {
  content: none;
}
```

(Only `.theme-toggle { margin-top: 0.5rem; }` is needed; drop the second rule.) The toggle reuses the global `button` style, so it is themed by `--accent`.

### 2. `theme.ts`

```ts
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'levelpath.theme';

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch (err) {
    console.warn('theme: could not read the stored theme', err);
  }
  const dark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    console.warn('theme: could not store the theme', err);
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
```

(A failing `localStorage` is logged and the theme still applies for the session; this is a typed fallback, not a silent failure.)

### 3. `ThemeToggle` and `App`

`components/ThemeToggle.tsx`:

```tsx
import type { Theme } from '../theme';

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      onClick={onToggle}
    >
      <span aria-hidden="true">{next === 'dark' ? '☾' : '☀'}</span>{' '}
      {next === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}
```

Visible text is "Dark"/"Light" and the `aria-label` carries the full action. In `App`:

```tsx
const [theme, setTheme] = useState<Theme>(loadTheme);
useEffect(() => applyTheme(theme), [theme]);
function toggleTheme() {
  const next = theme === 'dark' ? 'light' : 'dark';
  saveTheme(next);
  setTheme(next);
}
const picker = (
  <>
    <UserPicker userId={userId} onChange={pick} />
    <ThemeToggle theme={theme} onToggle={toggleTheme} />
  </>
);
```

`App` is above `Dashboard`'s `key`, so user switches don't touch the theme. Keep the effect body returning void (use a block body).

### 4. Inline script in `index.html`

In `<head>`, before the module script:

```html
<script>
  (function () {
    var theme = 'light';
    try {
      var stored = localStorage.getItem('levelpath.theme');
      if (stored === 'light' || stored === 'dark') theme = stored;
      else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        theme = 'dark';
    } catch (err) {
      console.warn('theme: falling back to light', err);
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  })();
</script>
```

Also add `<meta name="color-scheme" content="light dark" />`. In `applyTheme`, also set `document.documentElement.style.colorScheme = theme`.

### 5. Tests

- `theme.test.ts`:
  - `loadTheme` cases: stored wins over OS in both directions, invalid stored ignored, no `matchMedia`, throwing `localStorage`.
  - Contrast test: read `App.css` with `node:fs`, parse the two blocks with a regex into token maps, and compute the WCAG ratio (relative luminance helper in the test). Assert the pairs from the spec table, and that the light values for `--bg`, `--text` and `--accent` are the original ones. Also assert no hex outside the two blocks (strip the blocks, then regex).
  - Inline script test: extract the `<script>` body from `index.html`, run it with `new Function` (or `window.eval`) in jsdom under three setups (stub `matchMedia` and `localStorage` via `vi.stubGlobal` / `vi.spyOn(Storage.prototype, 'getItem')`), and assert `data-theme`, and the `console.warn` for the throwing case.
- `App.test.tsx` new `describe('theme')`: stub `matchMedia` with `vi.stubGlobal` (the existing `afterEach` unstubs and clears storage; also reset `document.documentElement.dataset.theme`). Cover criteria 1–5, including the button with no user picked, and switching the user via the picker keeping the theme. Use `mockFetch` as the neighbouring tests do.

### 6. Docs

Add to `docs/LEARNING.md` an entry "Theming with CSS custom properties and a no-flash script (Phase N)": tokens on `:root`, an attribute override, and why the inline script runs before the bundle.

### 7. Validate

Run the validation commands. Then run the app on chosen ports (CLAUDE.md "One app on chosen ports"), and check acceptance criterion 9 by eye in both themes, including a reload.

## Tests

As in step 5. No tenant data is touched, so no RLS test applies.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
grep -nE "#[0-9a-fA-F]{3,8}\b" apps/web/src/App.css   # only token-block lines
```

## Notes

- Run `pnpm lint` check-only; format files with Prettier before finishing, since the gate never fixes.
- `button.secondary`, `.badge-*` and `.suggested-tag` all need dark tokens. Don't forget `:focus-visible` and the `input, select, textarea` rule.
- Don't edit `factory/` or other protected paths.
