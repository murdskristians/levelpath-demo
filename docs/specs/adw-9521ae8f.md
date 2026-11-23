# Light/dark theme toggle in the header

> Issue #15: Add a light/dark theme toggle to the header · Type: feature

## Summary

- A toggle button in the header switches the whole web app between light and dark colours.
- First visit follows the system setting (`prefers-color-scheme`); a toggled choice is saved in `localStorage` and wins after reload.
- Web-only: no API, database or shared-schema change.

## Context

- `apps/web/src/App.css` hard-codes every colour as a hex value.
- `apps/web/src/App.tsx` renders `<header>` twice: in `Dashboard` (signed in) and in `App` (no user picked). Both receive the `UserPicker` node.
- `apps/web/src/users.ts` is the existing pattern for a `localStorage` key (`levelpath.userId`).
- jsdom has no `window.matchMedia`; existing `App.test.tsx` renders `App` without it.

## Requirements

1. A theme is `'light'` or `'dark'`. The current theme is exposed as `data-theme` on `document.documentElement`.
2. With nothing valid saved, the theme is dark if `matchMedia('(prefers-color-scheme: dark)')` matches, else light. If `matchMedia` is missing, light.
3. Clicking the toggle flips the theme and saves it under the `localStorage` key `levelpath.theme`.
4. A saved `'light'`/`'dark'` value wins over the system setting. Any other saved value is ignored (system setting used).
5. If `localStorage` read or write throws, the app still works (system setting / in-memory theme) and the error is logged with `console.warn`, not swallowed.
6. The toggle is a `<button type="button">` with `aria-pressed` (true when dark) and the stable accessible name "Dark theme", so `aria-pressed` carries the state. It appears in both headers.
7. All colours in `App.css` come from CSS custom properties defined for light (`:root`) and dark (`:root[data-theme='dark']`); `color-scheme` is set per theme. Light values stay as today. Dark text/background pairs meet WCAG AA (4.5:1) and the focus outline stays visible.

## Acceptance criteria

1. With no saved value and `matchMedia` reporting dark, rendering `<App />` gives `document.documentElement.dataset.theme === 'dark'` and the toggle has `aria-pressed="true"`. Verify: new Vitest test in `apps/web`.
2. Same with `matchMedia` reporting light (and with `matchMedia` undefined): `data-theme="light"`, `aria-pressed="false"`. Verify: Vitest.
3. Clicking the toggle changes `data-theme` and `aria-pressed`, and `localStorage.getItem('levelpath.theme')` equals the new theme. Verify: Vitest.
4. After toggling, unmounting and rendering `<App />` again restores the saved theme even when `matchMedia` says the opposite. Verify: Vitest.
5. A saved value `'purple'` is ignored and the system setting is used. Verify: Vitest.
6. When `localStorage.getItem` / `setItem` throw, `<App />` still renders, toggling still changes `data-theme`, and `console.warn` was called. Verify: Vitest.
7. The toggle is present with no user picked and with a user picked. Verify: Vitest (`getByRole('button', { name: 'Dark theme' })` in both states).
8. `grep -nE '#[0-9a-fA-F]{3,8}\b' apps/web/src/App.css` matches only inside the two variable-definition blocks. Verify: run the command.
9. Running the web app and clicking the toggle visibly recolours page, header border, inputs, buttons, request cards, badges, error alert, empty state and footer; a reload keeps the choice. Verify: the verifier on a chosen port.

## Tenant isolation and security

Not affected: no tenant data, API, auth or database is touched. The preference is client-side only and holds no PII; it is read defensively (validated against the two allowed values).

## Out of scope

- A third "system" option, following system changes live after load, server-side storage of the preference.
- Any change to `apps/api`, `packages/shared`, `db/`.
- A new dependency.

## Assumptions

- The toggle button keeps the shared button style rather than a new design.
- `data-theme` on `<html>` is used, so CSS can style `body` and everything below it.
- A brief flash of the light theme before React mounts is acceptable (no inline script in `index.html`).
