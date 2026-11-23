# Light/dark theme toggle in the header

> Issue #18: Add a light/dark theme toggle to the header · Type: feature

## Summary

- A toggle button in the header switches the whole web app between a light and a dark theme.
- The choice is saved in `localStorage` and used on every reload.
- With nothing saved, the app starts with the system setting (`prefers-color-scheme`).
- The theme is applied before first paint, so a reload does not flash the wrong colours.
- Web app only: no API, database or shared-schema change.

## Context

- `apps/web/src/App.tsx`: `App` renders the header in two places: inside `Dashboard` (picker plus identity line) and in the no-user branch (`<header>{picker}</header>`). The toggle must appear in both.
- `apps/web/src/App.css`: the only stylesheet; every colour is a hard-coded hex value (body, `footer`, `.empty-state`, `button`, `button:disabled`, `button.secondary`, `header`, `input/select/textarea`, `:focus-visible`, `.note`, `.request-list li`, `.badge-*`, `.error-alert`, `.field-error`, `.suggested-tag`, `.form-note`).
- `apps/web/src/users.ts`: the existing pattern for a `localStorage` key (`levelpath.userId`) with load and save helpers.
- `apps/web/index.html`: has no inline script; `apps/web/src/main.tsx` mounts `App`.
- jsdom (the test environment) has no `window.matchMedia`; the code must cope with that.

## Requirements

1. Two themes, `light` and `dark`. The current theme is the `data-theme` attribute on `<html>`.
2. All colours in `App.css` come from CSS custom properties: light values on `:root`, dark values under `:root[data-theme='dark']`. No hard-coded colour remains in a rule outside those two blocks. The light values equal today's colours, so the light theme looks unchanged. `color-scheme` is set per theme so native controls follow.
3. Dark values keep readable text contrast (WCAG AA, 4.5:1 for text) for body, header, footer, inputs, buttons (primary, secondary, disabled), request cards, all four status badges, the suggested tag, the error alert, field errors, the empty state, and the focus outline stays clearly visible against the background.
4. A button in the header, in both header variants (a user picked or not), toggles the theme. Its accessible name says what it will switch to: `Switch to dark theme` while light, `Switch to light theme` while dark. It has `type="button"`.
5. Initial theme: a stored value of `light` or `dark` wins; otherwise `prefers-color-scheme: dark` gives dark, anything else gives light. A missing or throwing `localStorage`, an invalid stored value, or a missing `window.matchMedia` falls back to the system setting or light, without throwing.
6. Clicking the toggle saves the new theme under the key `levelpath.theme`. If saving throws, the theme still changes for the session (the failure is logged with `console.warn`, not swallowed silently).
7. Before first paint, a small inline script in `apps/web/index.html` sets `data-theme` using the same rule as requirement 5, wrapped in `try/catch` so it never breaks page load.
8. After the user has clicked the toggle, later system-setting changes are ignored, and the app does not react live to system changes at all.
9. Tests cover the toggle, persistence, and the system default (see criteria).

## Acceptance criteria

1. With nothing stored and `matchMedia('(prefers-color-scheme: dark)')` mocked to match, rendering `<App />` sets `document.documentElement.dataset.theme` to `dark`; with it mocked not to match, to `light`. Verify: component test in `apps/web/src/App.test.tsx` (or a `theme` test file).
2. Rendering with no user picked shows a button named `Switch to dark theme` (light start) inside the `banner` (header). After picking a user, the header still contains exactly one such button. Verify: component test using `within(screen.getByRole('banner'))`.
3. Clicking the button changes `data-theme` from `light` to `dark`, changes its accessible name to `Switch to light theme`, and clicking again reverses both. Verify: component test.
4. After a click, `localStorage.getItem('levelpath.theme')` is the new theme; unmounting and rendering `<App />` again (a reload) starts in that theme even when `matchMedia` says the opposite. Verify: component test.
5. A stored value `"purple"` or a `localStorage.getItem` that throws, plus a `matchMedia` that is undefined, renders without throwing and ends in `light`. Verify: unit test of the theme helper.
6. `apps/web/index.html` contains an inline script before the module script that reads `levelpath.theme`, falls back to `prefers-color-scheme`, and sets `data-theme` on `document.documentElement` inside `try/catch`. Verify: a test reads `index.html` and asserts these (as `vite.config.test.ts` already reads files), and in a browser a reload on dark shows no light flash.
7. `grep -nE '#[0-9a-fA-F]{3,8}\b' apps/web/src/App.css` matches only lines inside the `:root` and `:root[data-theme='dark']` blocks. Verify: run the grep.
8. In a browser (app on chosen ports), toggle to dark: body, header, footer, inputs, buttons, request cards, badges, error alert (trigger with the API stopped) and the empty state are all dark-themed with readable text; the focus outline is visible on the toggle and inputs when tabbing. Reload keeps dark. Clear the key, set the browser's emulated colour scheme to dark, reload: starts dark.

## Tenant isolation and security

Not affected. The change is front-end styling and one `localStorage` key holding `light` or `dark`. It reads no tenant data, calls no API, and never touches `X-User-Id`. A stored value is validated against the two allowed strings before use; it is never inserted into HTML.

## Out of scope

- A "follow system" third option, and live reaction to system changes.
- Per-user or server-side storage of the theme.
- Any redesign of colours or layout beyond making the existing colours themeable.
- New dependencies, a theming library, or a CSS framework.
- Changes to the API, `packages/shared`, `db/`, or protected paths.

## Assumptions

- The storage key is `levelpath.theme`, matching the existing `levelpath.userId` naming.
- The toggle is a plain text button ("Dark theme" / "Light theme" visible text is not required; accessible name is what matters), reusing the existing button style, not a new icon set.
- The inline script duplicates the three-line selection rule, because it must run before the bundle loads. This is accepted and kept in sync by the `index.html` test.
- Dark palette values are the builder's choice, provided requirement 3 holds.
