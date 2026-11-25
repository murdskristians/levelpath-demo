# Light/dark theme toggle

> Issue #22: Intent: Light/dark theme toggle · Type: feature · Intent: issue #22 (no `docs/intent` file)

## Summary

- The web app gets a dark theme next to today's light one. The light theme looks exactly as it does now.
- On a first visit the theme follows the OS (`prefers-color-scheme`). A header button, next to the user picker, switches light and dark.
- The choice is kept in `localStorage`. It beats the OS from then on, and it survives reloads and user switches.
- The right theme is set before first paint, so the page never flashes the wrong one.
- Web only (`apps/web`). No API, `packages/shared` or `db/` change.

## Context

- `apps/web/src/App.css` holds every color as a hard-coded hex value (about 34 values). Nothing uses custom properties.
- `apps/web/src/App.tsx`: `App` builds `picker = <UserPicker …/>` and passes it to the `<header>` in both branches (no user picked, and `Dashboard`). `apps/web/src/components/UserPicker.tsx` renders the picker.
- `apps/web/src/users.ts` is the pattern for browser storage: a `levelpath.*` key with `loadX`/`saveX`.
- `apps/web/index.html` has no inline script. `apps/web/src/main.tsx` renders `<App />`.
- Tests: `apps/web/src/App.test.tsx` (Vitest + Testing Library, jsdom, `localStorage.clear()` in `afterEach`).

## Requirements

1. All colors in `App.css` come from CSS custom properties defined on `:root`. The light values equal today's hex values, so the light theme is unchanged.
2. A dark palette is defined under `:root[data-theme='dark']`. `color-scheme` is `light` / `dark` to match, so native controls follow.
3. Every screen is themed in both themes: header, request list, new-request form (Suggest fields included), decision queue, error alerts, empty states, badges and disabled buttons. Body text, labels, notes and controls meet WCAG AA (text 4.5:1, borders, focus ring and other control boundaries 3:1) against the surface they sit on.
4. The initial theme is the stored choice (`localStorage` key `levelpath.theme`, value `light` or `dark`). With no valid stored value it is the OS preference (`prefers-color-scheme: dark` gives dark, anything else light).
5. A button in the header, next to the user picker, switches the theme. Its accessible name says what pressing it does: `Switch to dark theme` while light, `Switch to light theme` while dark. Pressing it saves the new theme, so it wins over the OS from then on.
6. Switching users in the picker keeps the theme, and a reload keeps it.
7. The theme is applied as `data-theme` on `<html>` before first paint: a small inline script in `index.html` does it, with the same rule as requirement 4. If `localStorage` throws (blocked storage), the script and the app fall back to the OS preference and the toggle still works for the session. The failure is logged with `console.warn` rather than swallowed.
8. Tests in `apps/web` cover the toggle, the stored choice, the OS default, an invalid stored value, user-switch persistence and the contrast of the palette.

## Acceptance criteria

1. With nothing stored and the OS in dark mode (`matchMedia('(prefers-color-scheme: dark)')` matches), rendering `<App />` sets `document.documentElement.dataset.theme` to `dark`. With the OS in light mode, or `matchMedia` not matching, it is `light`. Verified by a Vitest test.
2. With `levelpath.theme` = `light` and the OS in dark mode, the theme is `light` (the stored choice wins). With `dark` and the OS in light mode, it is `dark`. Verified by a Vitest test.
3. A stored value that is not `light` or `dark` (for example `blue`) is ignored: the OS preference applies. Verified by a Vitest test.
4. In the header, a button named `Switch to dark theme` is present while the theme is light. Clicking it sets `data-theme` to `dark`, stores `dark` under `levelpath.theme`, and renames the button `Switch to light theme`. Clicking again reverses all three. Verified by a Vitest test using `getByRole('button', { name: … })`.
5. The toggle is in the same `<header>` as the user picker, both with a user picked and with none (`within(header)` finds both). Verified by a Vitest test.
6. After switching the toggle to dark, picking another user in the picker leaves `data-theme` as `dark`, and re-rendering `<App />` (a reload) with the stored value gives `dark` again. Verified by a Vitest test.
7. `apps/web/index.html` contains an inline script in `<head>`, before the stylesheet-bearing module script, that sets `data-theme` on `document.documentElement` using the stored value, else `matchMedia`. A Vitest test reads the file, extracts the script, runs it under jsdom for four cases (stored light, stored dark, none with OS dark, none with OS light) and checks the attribute. A second case with a throwing `localStorage` checks it falls back to the OS value without throwing.
8. `App.css` has no hex color outside the `:root` and `:root[data-theme='dark']` blocks. A Vitest test reads the file and asserts it.
9. A Vitest test parses both palette blocks in `App.css` and asserts the contrast ratio is at least 4.5:1 for every text/background pair that the stylesheet uses (body text on page; muted text on page; button text on button; secondary button text on its background; each badge text on its badge; error text on the alert and on the page; suggested tag; input text on input; disabled button text on its background) and at least 3:1 for the input border, focus ring and the button border against the page, in both themes. The light values must additionally equal the original hex values listed in the plan.
10. Manual check (verifier): run the app on chosen ports. In a browser with dark OS mode and cleared storage, the first load is dark with no light flash. The button flips the theme. After a reload the choice stays. Switching between Alice, Amir, Bella and Boris keeps it. With Amir, the list, the new-request form with Suggest fields, the decision queue, an error alert and an empty state are all legible in both themes. In light mode the page is visually identical to `main`.

## Tenant isolation and security

Not affected. The theme is a browser-only preference in `localStorage`: no API call, no tenant data, no database or RLS change. The stored value is validated against `light`/`dark` before use and is only ever set as a `data-theme` attribute, never as HTML. Nothing in it is a secret or PII. `X-User-Id` is untouched.

## Out of scope

- Per-tenant branding or palettes, server-side or cross-browser memory.
- A "System" option to return to following the OS, and a keyboard shortcut.
- Any UI library or CSS framework, and any redesign of the light look (spacing, fonts, layout stay as they are).
- Changes to `apps/api`, `packages/shared`, `db/`, or any protected path.

## Assumptions

- The key is `levelpath.theme`, following `levelpath.userId`.
- The theme is applied through `data-theme` on `<html>`, not a class, so the inline script and CSS agree on one attribute.
- Following the OS live (when the OS setting changes while the page is open and nothing is stored) is not required: the OS is read at load.
- The button label is text only (`Switch to dark theme` / `Switch to light theme`), shown visibly, so no icon asset or `aria-label` mismatch. It is an ordinary `button`, so it keeps the global button style; a `.theme-toggle` class only sets `margin-top: 0.5rem`.
- The dark palette is the builder-checkable one in the plan; if a pair fails the contrast test, the builder adjusts that dark value, not the test.
