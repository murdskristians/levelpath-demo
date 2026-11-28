# Light/dark theme toggle

> Issue #65: Light/dark theme toggle · Type: feature · Intent: in the issue body

## Summary

- Colors in `apps/web/src/App.css` become CSS custom properties. The light values equal today's, and a dark set is added.
- On a first visit the theme follows the OS (`prefers-color-scheme`).
- A header button next to the user picker switches light ↔ dark. The choice is stored in `localStorage` and wins over the OS from then on.
- An inline script in `index.html` sets the theme on `<html>` before first paint, so there is no flash.
- Web only. No API, `packages/shared` or `db/` change.

## Context

- `apps/web/src/App.css` holds every color as a hard-coded hex value (about 34).
- `apps/web/src/App.tsx`: `App` builds a `picker` element (`UserPicker`) that both `Dashboard` and the no-user branch render inside `<header>`. The header is the place for the toggle.
- `apps/web/src/users.ts` already persists the chosen user in `localStorage` (`levelpath.userId`). The theme uses the same pattern.
- `apps/web/index.html` has no scripts besides the Vite entry.
- Tests are Vitest + jsdom + Testing Library (`apps/web/src/App.test.tsx`). jsdom has no `window.matchMedia`.

## Requirements

1. All colors in `App.css` come from custom properties defined on `:root` (light) and overridden under `:root[data-theme='dark']` (dark). The light values are exactly today's, so the light theme looks unchanged.
2. The dark palette (every text/background pair listed below) meets WCAG AA: 4.5:1 for text, 3:1 for control borders and focus outlines.
3. A new `apps/web/src/theme.ts` exports the theme logic: `Theme` type, `THEME_KEY = 'levelpath.theme'`, `loadTheme()` (stored `'light'|'dark'`, otherwise the OS preference, otherwise `'light'`; works when `matchMedia` is missing), `saveTheme(theme)`, and `applyTheme(theme)` (sets `document.documentElement.dataset.theme`).
4. `App` keeps the theme in state, initialised from `loadTheme()`, and applies it to `<html>`. A `ThemeToggle` button is rendered in the header beside the user picker, in both the "no user picked" and the dashboard views. It shows the same state in both and survives user switches (it is not reset by `Dashboard`'s `key`).
5. Pressing it flips the theme, applies it, and stores it in `localStorage`. Its accessible name states the action: "Switch to dark theme" while light, "Switch to light theme" while dark. An emoji icon (☾ / ☀) may be shown with `aria-hidden`.
6. Before first paint, an inline script in `index.html` sets `data-theme` on `<html>` using the same rule as `loadTheme()` (stored value, else OS, else light). It has a `try/catch` that logs with `console.warn` and falls back to light. `color-scheme` is set to match, so native controls and scrollbars follow.
7. The toggle is themed too (light and dark), is keyboard-reachable like any button, and has the focus ring.
8. Every current screen is themed through the variables: header, request list and badges, new-request form (Suggest fields, the "suggested" tag, field errors), decision queue, error alerts, empty states, disabled buttons, footer.

### Dark palette (page `#111827`)

| Token                                             | Light (today)                     | Dark                              | Dark contrast    |
| ------------------------------------------------- | --------------------------------- | --------------------------------- | ---------------- |
| `--bg`                                            | `#ffffff`                         | `#111827`                         | n/a              |
| `--text`                                          | `#1a1a1a`                         | `#f3f4f6`                         | ~16:1 on bg      |
| `--text-muted` (footer, `.note`)                  | `#4b5563`                         | `#9ca3af`                         | ~6.7:1 on bg     |
| `--text-form-note`                                | `#374151`                         | `#d1d5db`                         | ~12:1 on bg      |
| `--border`                                        | `#d1d5db`                         | `#374151`                         | decorative       |
| `--border-dashed`                                 | `#6b7280`                         | `#9ca3af`                         | ≥3:1             |
| `--border-input`                                  | `#4b5563`                         | `#9ca3af`                         | ≥3:1 on input bg |
| `--input-bg` / `--input-text`                     | `#ffffff` / `#1a1a1a`             | `#1f2937` / `#f3f4f6`             | ~13:1            |
| `--accent` (button bg and border) / `--on-accent` | `#1d4ed8` / `#ffffff`             | `#60a5fa` / `#0b1220`             | ~7:1             |
| `--secondary-bg` / `--secondary-text`             | `#ffffff` / `#1d4ed8`             | `#111827` / `#93c5fd`             | ~9:1             |
| `--focus`                                         | `#1d4ed8`                         | `#93c5fd`                         | ≥3:1 on bg       |
| `--disabled-bg` / `-border` / `-text`             | `#e5e7eb` / `#d1d5db` / `#4b5563` | `#1f2937` / `#374151` / `#9ca3af` | ~5.6:1           |
| badge draft bg / text                             | `#e5e7eb` / `#1f2937`             | `#374151` / `#f3f4f6`             | ~8:1             |
| badge submitted and suggested-tag bg / text       | `#dbeafe` / `#1e3a8a`             | `#1e3a8a` / `#dbeafe`             | ~8:1             |
| badge approved bg / text                          | `#dcfce7` / `#14532d`             | `#14532d` / `#dcfce7`             | ~9:1             |
| badge rejected bg / text                          | `#fee2e2` / `#7f1d1d`             | `#7f1d1d` / `#fee2e2`             | ~9:1             |
| error-alert bg / text / border                    | `#fef2f2` / `#7f1d1d` / `#991b1b` | `#450a0a` / `#fecaca` / `#f87171` | ~11:1            |
| `--field-error`                                   | `#991b1b`                         | `#fca5a5`                         | ~9:1 on bg       |

The builder may adjust a dark value only to meet AA; the contrast test in criterion 6 decides.

## Acceptance criteria

1. **OS default, dark.** With nothing stored and `matchMedia('(prefers-color-scheme: dark)')` matching, rendering `<App />` leaves `document.documentElement.dataset.theme === 'dark'` and the button's name is "Switch to light theme". Verified by a Vitest test.
2. **OS default, light, and no `matchMedia`.** With nothing stored and a non-matching or missing `matchMedia`, the theme is `light` and the button's name is "Switch to dark theme". Vitest test.
3. **Toggle.** Clicking the button flips `data-theme`, flips the button's name, and writes `localStorage['levelpath.theme']` (`'dark'` then `'light'`). Vitest test.
4. **Stored choice wins.** With `localStorage['levelpath.theme'] = 'light'` and the OS dark, the theme is `light`; with `'dark'` and the OS light, it is `dark`. An invalid stored value is ignored (falls back to the OS). Vitest tests.
5. **Persists across user switches.** After toggling, changing the user in the header picker keeps `data-theme` and the stored value unchanged. The button is present with no user picked as well as with one. Vitest test.
6. **Contrast.** A Vitest test reads `App.css`, parses the dark and light token blocks, and asserts every text/background pair in the palette table is ≥4.5:1 (borders and focus ≥3:1) in both themes. It also asserts the light block values equal today's (`--bg` `#ffffff`, `--text` `#1a1a1a`, `--accent` `#1d4ed8`).
7. **No hard-coded colors left.** `grep -nE "#[0-9a-fA-F]{3,8}\b" apps/web/src/App.css` matches only lines inside the two token blocks (`:root` and `:root[data-theme='dark']`).
8. **No flash.** `apps/web/index.html` contains an inline script in `<head>` (before the module script) that sets `data-theme` and `color-scheme`. A Vitest test reads the file and runs the script in jsdom with each of: nothing stored and OS dark → `dark`; stored `light` with OS dark → `light`; `localStorage` throwing → `light` and a `console.warn`.
9. **Manual look.** Run the app (ports per CLAUDE.md), open it, press the button: header, request list with each badge, new-request form with Suggest fields, decision queue (as Amir), an error alert, the empty state and a disabled button all read well in both themes; reloading keeps the choice and shows no flash of the other theme. The light theme looks as before.
10. `pnpm build`, `pnpm lint` and `pnpm test` pass (via `factory/checks.sh`).

## Tenant isolation and security

Not affected: the choice is a browser-only `localStorage` string. There are no API, database, RLS or tenant changes. Only the literal values `'light'` and `'dark'` are read back and applied. The inline script sets an attribute only from that checked value, never from untrusted input.

## Out of scope

- A "System" option, per-tenant or server-side themes, a keyboard shortcut.
- Live reaction to OS theme changes after load while nothing is stored.
- A UI library or CSS framework, and any redesign or change to the light look.
- Any change to `apps/api`, `packages/shared` or `db/`.

## Assumptions

- Dark theme is selected by `data-theme="dark"` on `<html>`. The attribute is always set (`light` or `dark`), so CSS needs no `prefers-color-scheme` media query.
- Storage key `levelpath.theme`, matching the existing `levelpath.userId` naming.
- Button: emoji icon plus visible text ("Dark" / "Light"), accessible name from `aria-label`.
- The inline script duplicates the 6-line rule from `theme.ts` (it must run before the bundle); the test in criterion 8 keeps them in agreement.
