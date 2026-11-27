# Light/dark theme toggle

> Issue #58: Light/dark theme toggle · Type: feature · Intent: issue #58 body (no file under docs/intent/)

## Summary

- The web app gets a dark theme next to today's light one. Colors move from hard-coded hex values into CSS custom properties.
- On a first visit the theme follows the OS `prefers-color-scheme`. A header button switches light and dark, and that choice wins from then on.
- The choice is stored in `localStorage`, so it survives reloads and user switches. No API, database or shared-package change.
- The theme is applied before first paint, so the wrong theme never flashes.
- Vitest + Testing Library tests cover the toggle, the stored choice and the OS default.

## Context

- `apps/web/src/App.css`: the only stylesheet, about 34 hard-coded hex colors, no variables.
- `apps/web/src/App.tsx`: `App` builds the `picker` node (`UserPicker`) and renders it inside `<header>`. `Dashboard` renders it when a user is picked, and `App` renders it when none is.
- `apps/web/src/users.ts`: the existing `localStorage` pattern (`levelpath.userId`, `loadUserId`, `saveUserId`).
- `apps/web/index.html`: the page shell, with no inline script yet.
- `apps/web/src/App.test.tsx` and `src/test/fixtures.ts`: the existing test style (`mockFetch`, `localStorage` cleanup).

## Requirements

1. All colors in `App.css` come from CSS custom properties. The values for the light theme equal today's colors, so the light theme looks unchanged.
2. A dark set of values exists, selected by `data-theme="dark"` on `<html>`. The light set is the default.
3. With no stored choice, the theme equals the OS `prefers-color-scheme`. After the user presses the toggle, the stored choice wins over the OS, across reloads and user switches.
4. One button sits in the header next to the user picker, both when a user is picked and when none is. Its accessible name says what pressing it does: "Switch to dark theme" while light, "Switch to light theme" while dark.
5. The choice is stored in `localStorage` under `levelpath.theme` (`light` or `dark`). Any other stored value is ignored and the OS preference is used. If `localStorage` throws, the app logs it with `console.warn` and carries on with the OS preference.
6. The theme is set on `<html>` before first paint by a small inline script in `index.html`, and React keeps it in sync after that. The script and the React code share the same rule (stored value if valid, otherwise the OS preference).
7. Every screen is themed: header, request list and badges, new-request form (Suggest fields and the "suggested" tag included), decision queue, error alerts, field errors, empty states, disabled buttons, the footer and focus outlines.
8. Text meets WCAG AA contrast (4.5:1, large text 3:1) and input borders, focus outlines and the toggle meet 3:1, in both themes. The dark palette is listed in plan.md.
9. Plain CSS only: no new dependency, no UI library.
10. Tests: Vitest + Testing Library tests for the toggle, the stored choice and the OS default.

## Acceptance criteria

1. With `localStorage` empty and `prefers-color-scheme: dark`, rendering `<App />` gives `document.documentElement.dataset.theme === 'dark'` and a button named "Switch to light theme". With the OS set to light, the theme is `light` and the button is named "Switch to dark theme". Verify: Vitest, with `window.matchMedia` stubbed.
2. Clicking the button flips `data-theme` on `<html>`, flips the button's name and writes `levelpath.theme` to `localStorage`. Verify: Vitest.
3. A stored `levelpath.theme` of `light` beats an OS preference of dark, and `dark` beats an OS preference of light. Verify: Vitest.
4. A stored value other than `light` or `dark` is ignored and the OS preference is used. Verify: Vitest.
5. Switching the user in the picker keeps the theme and the stored value. Verify: Vitest.
6. The toggle appears in the header when no user is picked, and when one is picked. Verify: Vitest.
7. If `localStorage.setItem` or `getItem` throws, the app still renders, the theme follows the OS, and `console.warn` is called. Verify: Vitest.
8. `apps/web/index.html` contains an inline `<script>` in `<head>` that sets `data-theme` on `document.documentElement` and has no comment-only `catch`. Verify: a test reads the file, extracts the script and runs it in jsdom. It checks the result for no stored value (with each OS preference), a stored `dark`, and a stored garbage value.
9. In `App.css`, hex colors appear only in the `:root` and `[data-theme='dark']` blocks. Verify: a test or `grep -n '#[0-9a-fA-F]\{3,6\}' apps/web/src/App.css` shows no hex outside those two blocks.
10. The light values in `:root` equal the previous hex colors of each rule. Verify: diff review against `git show origin/main:apps/web/src/App.css`.
11. Both themes meet the contrast pairs listed in plan.md. Verify: a Vitest test computes the WCAG ratio for each listed pair from the values in `App.css` and asserts the minimums.
12. On a loaded page (`pnpm --filter @levelpath/web dev`), toggling to dark and reloading gives a dark page with no light frame. Verify: open it, with the OS set to light, press the toggle, reload, and check that `<html data-theme="dark">` is set before the app renders.

## Tenant isolation and security

Not affected. The theme is a per-browser UI preference in `localStorage` and holds no tenant data. There is no API, database, RLS or auth change. The inline script reads only `localStorage` and `matchMedia`, takes no input from the URL or the server, and writes only a fixed value (`light` or `dark`).

## Out of scope

- Per-tenant branding, palettes or logos.
- Server-side or cross-browser storage of the theme.
- A "System" option to return to following the OS.
- A keyboard shortcut for the toggle.
- A UI library, CSS framework or any redesign of the current look.
- Changes to `apps/api`, `packages/shared` or `db/`.
- Reacting live to OS theme changes after the page has loaded.

## Assumptions

- The toggle is a text button, with no icon. This keeps the accessible name and visible label identical and avoids an SVG.
- The theme is set through `data-theme` on `<html>`, always resolved to `light` or `dark`. The stylesheet needs no `@media (prefers-color-scheme)` block.
- OS changes made while the page is open are not followed. The OS is read at load time only.
- The dark palette is the one in plan.md, picked by the planner as the issue allows.
- The storage key is `levelpath.theme`, matching the existing `levelpath.userId` style.
