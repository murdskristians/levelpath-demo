# Plan: Light/dark theme toggle

> Spec: agents/9521ae8f/spec.md · Type: feature

## Approach

CSS custom properties hold every colour; `data-theme` on `<html>` switches the set. A small `useTheme` hook (modelled on `users.ts`) picks the initial theme (saved value, else `matchMedia`, else light), applies it, and persists on toggle. A `ThemeToggle` button renders in both headers. No library: smaller and fits the stack.

## Libraries and versions

None. (Uses React 19, Vitest 5 and Testing Library, already in `apps/web/package.json`.)

## Files

- `apps/web/src/App.css` — replace hex colours with variables; add light and dark variable blocks.
- `apps/web/src/App.tsx` — call `useTheme`, put `ThemeToggle` next to the picker in both headers.
- `apps/web/src/App.test.tsx` — add a `theme` describe; reset `data-theme` in afterEach.
- `docs/LEARNING.md` — short note on theme variables + `data-theme`.

### New files

- `apps/web/src/theme.ts` — `Theme` type, `loadTheme()`, `saveTheme()`, `useTheme()`.
- `apps/web/src/components/ThemeToggle.tsx` — the button.

## Steps

### 1. Theme logic

`theme.ts`, key `levelpath.theme`:

- `systemTheme()`: dark only if `typeof window.matchMedia === 'function'` and `matchMedia('(prefers-color-scheme: dark)').matches`; else light.
- `loadTheme()`: try `localStorage.getItem(KEY)`; return it if it is `'light'` or `'dark'`; on throw, `console.warn` and fall through; else `systemTheme()`.
- `saveTheme(t)`: try `setItem`; on throw `console.warn`.
- `useTheme()`: `useState(loadTheme)`; `useEffect` sets `document.documentElement.dataset.theme`; `toggle` computes the next theme, sets state and calls `saveTheme`. Save only on toggle, never on mount, so the system default is not persisted.

### 2. UI

- `ThemeToggle({ theme, onToggle })`: `<button type="button" className="secondary" aria-pressed={theme === 'dark'} onClick={onToggle}>Dark theme</button>`.
- `App.tsx`: in `App`, `const { theme, toggle } = useTheme()`; build `picker` as a fragment of `UserPicker` and `ThemeToggle`, so both headers (including `Dashboard`'s `picker` prop) get it with no other change.
- `App.css`: define variables (bg, text, muted, borders, primary, on-primary, surface, disabled-_, badge-_, error-_, suggested-_) in `:root` with the current light hex values and in `:root[data-theme='dark']` with AA-contrast dark values (lighter blue primary). Add `color-scheme`. Replace every hex in the rules with `var(--…)`. Keep the focus outline on the primary variable.

### 3. Tests (in `App.test.tsx`)

Helper `stubSystem(dark)` using `vi.stubGlobal('matchMedia', …)` (afterEach already unstubs). Cover acceptance criteria 1–7. For 6, spy on `Storage.prototype.getItem`/`setItem` to throw and assert `console.warn`. Clear `data-theme` in afterEach.

### 4. Docs

Add the `LEARNING.md` note.

### 5. Validate

Run the validation commands.

## Tests

System default (dark, light, no `matchMedia`), toggle and persistence, remount keeps the saved choice over the system, invalid saved value ignored, storage throwing, toggle in both headers. Tenant isolation: not applicable (no data access).

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
grep -nE '#[0-9a-fA-F]{3,8}\b' apps/web/src/App.css   # only inside the two variable blocks
```

Plus: run the web app on a chosen port (`pnpm --filter @levelpath/web dev --port <w> --strictPort`, API on `API_PORT`), toggle, reload, check both themes; stop with `factory/bin/port stop <port>`.

## Notes

- `pnpm lint` is a Prettier check only; format new files accordingly.
- Existing tests render `App` without `matchMedia`, so the guard in `systemTheme()` is required.
- Existing tests mock `console.error`, not `console.warn`; use `warn` for storage problems.
