# Light/dark theme toggle

> Issue #23: Add a light/dark theme toggle · Type: feature · Intent: none in `docs/intent/` (the intent is the issue body)

## Summary

- The web app gets a dark theme next to today's light one, built from CSS custom properties in `apps/web/src/App.css`.
- On first visit the theme follows the OS (`prefers-color-scheme`); a header button switches light/dark and that choice, stored in `localStorage`, wins from then on.
- The theme is applied before first paint, so the page never flashes the wrong theme.
- Every current screen is themed and meets WCAG AA in both themes. The light theme looks as it does today.
- Web only: no API, `packages/shared` or `db/` change.

## Context

- `apps/web/src/App.css` holds all colors as hard-coded hex values (about 34). Nothing else in `apps/web/src` sets colors (no inline `style=`).
- `apps/web/src/App.tsx` renders the header in two places: inside `Dashboard` (picker plus identity line) and in the "pick a user" branch of `App`. Both receive the same `picker` node built in `App`.
- `apps/web/src/components/UserPicker.tsx` is the header user picker. `apps/web/src/users.ts` shows the existing `localStorage` pattern (`levelpath.userId`, `loadUserId`/`saveUserId`).
- `apps/web/index.html` is the Vite entry; `apps/web/src/main.tsx` mounts `<App />`.
- Tests: `apps/web/src/App.test.tsx` (Vitest + Testing Library, jsdom, which has no `window.matchMedia`).

## Requirements

1. All colors in `App.css` come from CSS custom properties declared on `:root` (light values equal to today's hex values, so the light theme is visually unchanged) and overridden under `:root[data-theme='dark']`. `color-scheme` is set to `light` / `dark` accordingly so native controls match.
2. A dark palette meets WCAG AA: 4.5:1 for text, 3:1 for control borders, focus outline and other UI boundaries. Light is unchanged and already assumed to comply.
3. Theme resolution: a stored choice (`localStorage` key `levelpath.theme`, value `light` or `dark`) wins; otherwise `window.matchMedia('(prefers-color-scheme: dark)')` decides; if `matchMedia` is missing or the stored value is invalid, light. `localStorage` access that throws must not break the app.
4. The chosen theme is set as `data-theme` on `<html>` before first paint, by a small inline script in `apps/web/index.html` using the same rules as requirement 3.
5. One button in the header, next to the user picker, in both the signed-in header and the "pick a user" header. Its accessible name states the action: `Switch to dark theme` when light is active, `Switch to light theme` when dark is active. It is a real `<button type="button">`.
6. Pressing it flips the theme, updates `data-theme` on `<html>`, and stores the new value in `localStorage`. Before it is pressed nothing is stored (the OS keeps deciding). The choice persists across reloads and across switching users in the picker (the toggle state lives above the keyed `Dashboard`).
7. Themed screens: header, footer, request list, badges, new-request form (inputs, Suggest fields, suggested tag, notes, field errors), decision queue, error alerts, empty states, disabled and secondary buttons, focus outline.
8. Tests in `apps/web` cover the toggle and the stored choice (see criteria).

## Acceptance criteria

1. With no stored value and `matchMedia('(prefers-color-scheme: dark)')` matching, rendering `<App />` sets `document.documentElement.dataset.theme` to `dark` and the button's name is `Switch to light theme`. With a non-matching OS preference, `light` and `Switch to dark theme`. Verify: Vitest test with a stubbed `matchMedia`.
2. With `levelpath.theme` = `light` stored and an OS preference of dark, the app renders light (stored choice wins), and the reverse. Verify: Vitest test.
3. Clicking the button flips `data-theme`, flips the button's name, and writes the new value to `localStorage['levelpath.theme']`. With nothing pressed, `localStorage['levelpath.theme']` is still null. Verify: Vitest test.
4. After pressing the toggle, switching user in the picker keeps the theme and the stored value. Verify: Vitest test (render as Alice, toggle, select another user, assert).
5. The button is present in the "pick a user" header (no user stored) and in the signed-in header. Verify: Vitest test queries it in both states.
6. An invalid stored value (`purple`), a missing `matchMedia`, and a throwing `localStorage.getItem` all fall back without crashing. Verify: Vitest unit test of the theme helper.
7. `apps/web/index.html` contains an inline script before the module script that sets `data-theme` on `document.documentElement` using the same rules, wrapped in `try/catch` so a failure falls back to light (and logs nothing silently: it leaves the attribute unset, which CSS treats as light). Verify: read the file; a Vitest test may evaluate the script text against a stubbed `window` to assert it agrees with the helper for the four cases (stored dark, stored light, OS dark, OS light).
8. `App.css` has no hex colors outside the two custom-property blocks (`:root` and `:root[data-theme='dark']`). Verify: `grep -nE "#[0-9a-fA-F]{3,6}" apps/web/src/App.css` only matches lines inside those blocks; a Vitest test may assert this by reading the file.
9. The light theme is unchanged: each light custom property equals the hex it replaced. Verify: review the diff of `App.css`; open the app with the OS in light mode and compare with `main`.
10. In the browser (`pnpm dev`, ports per CLAUDE.md), with the OS in dark mode and nothing stored, the page loads dark with no white flash; clicking the button gives light and a reload keeps it; the button label and icon are visible in both themes. Verify: load the page, inspect `document.documentElement.dataset.theme` and `localStorage`.
11. Every screen listed in requirement 7 reads well in dark: a pass through the signed-in Alice (list, new-request form with Suggest fields, error alert, empty state, disabled Submit/Save buttons) and Amir (decision queue) views shows no light-colored block with light text or dark text on dark background. Verify: visual check plus the contrast pairs listed in the plan.

## Tenant isolation and security

Not affected. The choice lives only in the browser's `localStorage`; no API, database, migration or tenant data is touched, and no tenant id is read from or sent anywhere. The stored value is validated against `light`/`dark` before use and is only ever written to a `data-theme` attribute, never to HTML.

## Out of scope

- Per-tenant branding, palettes or logos; server-side or cross-browser persistence.
- A third "System" option to return to following the OS.
- A keyboard shortcut for the toggle.
- Any UI library or CSS framework, and any restyling of the light theme.
- Changes to `apps/api`, `packages/shared` or `db/`.

## Assumptions

- Storage key is `levelpath.theme`, matching the existing `levelpath.userId` naming.
- The inline script in `index.html` is allowed (the app has no Content-Security-Policy); it is the standard way to avoid a flash with a client-rendered app.
- The button label is text with an emoji or inline SVG icon marked `aria-hidden`; its accessible name is the text above. A visible text label is acceptable.
- The header gains a small flex wrapper so the toggle sits beside the picker; this is a layout necessity, not a restyle of colors.
