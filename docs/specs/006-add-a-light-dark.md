# Light/dark theme toggle in the header

> Issue #28: Add a light/dark theme toggle to the header · Type: feature · Intent: docs/intent/theme-toggle.md

## Summary

- A dark theme is added next to the existing (unchanged) light theme, both defined as CSS custom properties in `apps/web/src/App.css`.
- On first visit the theme follows the OS (`prefers-color-scheme`); a header button switches light/dark and the choice, stored in `localStorage`, wins from then on.
- The theme is set on `<html>` by an inline script before first paint, so the wrong theme never flashes.
- Web only: no API, `packages/shared`, `db/` or tenant change.

## Context

- All colors are hard-coded hex values in `apps/web/src/App.css` (body, footer, `.empty-state`, `button`, `button:disabled`, `button.secondary`, `header`, inputs, `:focus-visible`, `.note`, `.request-list li`, `.badge-*`, `.error-alert`, `.field-error`, `.suggested-tag`, `.form-note`).
- `apps/web/src/App.tsx` renders the header in two places (a user selected, in `Dashboard`; none selected, in `App`), both through the `picker` element built in `App`. `Dashboard` is keyed by user id and remounts on user switch, so theme state must live in `App` (or above), not in `Dashboard`.
- `apps/web/src/users.ts` is the existing pattern for `localStorage` (key `levelpath.userId`).
- `apps/web/index.html` has no inline script; `apps/web/src/main.tsx` renders `<App />`.
- Tests: `apps/web/src/App.test.tsx` (Vitest + Testing Library, jsdom). jsdom has no `window.matchMedia`.

## Requirements

1. `App.css` defines every color as a CSS custom property on `:root` (the light values, identical to today's hex values) and a dark override set under `:root[data-theme='dark']`. No hard-coded hex color remains outside those two blocks. The rendered light theme is unchanged.
2. `:root` sets `color-scheme: light`, and the dark block `color-scheme: dark`.
3. The theme is the value of the `data-theme` attribute (`light` or `dark`) on `<html>`.
4. Initial theme: the stored choice if `localStorage['levelpath.theme']` is exactly `light` or `dark`; otherwise `dark` if `matchMedia('(prefers-color-scheme: dark)').matches`, else `light`. A missing `localStorage` or `matchMedia`, a throwing `localStorage`, or any other stored value must not throw and falls through to the next rule (ending in `light`).
5. An inline script in `apps/web/index.html` `<head>` applies requirement 4 to `document.documentElement` before first paint, in a try/catch that never throws.
6. A button in the header, next to the user picker, toggles light/dark. It is rendered in both header states (user picked, and no user picked). Its accessible name states the action: `Switch to dark theme` while light, `Switch to light theme` while dark. It is a native `<button type="button">`, reachable by keyboard.
7. Pressing the toggle sets `data-theme` on `<html>` and writes `levelpath.theme` to `localStorage`. A write failure is caught and does not stop the switch. Without a press nothing is written (the OS default stays live).
8. The choice survives a reload and switching users in the picker (theme state lives in `App`, outside the keyed `Dashboard`).
9. Every current screen is themed in both themes: header, request list and badges, new-request form including Suggest fields and the "Suggested" tag, decision queue, error alerts and field errors, empty states, disabled buttons, secondary buttons, notes, footer, focus outline.
10. Dark palette meets WCAG AA (4.5:1 for text, 3:1 for borders/outlines against the page) for every text/background pair the stylesheet uses.
11. Tests in `apps/web` cover the toggle, the stored choice and the OS default.

## Acceptance criteria

1. `pnpm --filter @levelpath/web test` includes a test that renders `<App />` with `matchMedia` stubbed to `matches: false` and no stored value, and finds a button named `Switch to dark theme` with `document.documentElement.dataset.theme === 'light'`. Same with `matches: true`: the button is named `Switch to light theme` and the theme is `dark`.
2. A test clicks the toggle: `data-theme` flips, the button name flips, and `localStorage.getItem('levelpath.theme')` is `dark` (then `light` after a second click).
3. A test stores `light` while the stub says the OS is dark, renders, and sees `light` (stored choice wins over OS). A test stores `dark` with OS light and sees `dark`.
4. A test with no stored value and no click asserts `localStorage.getItem('levelpath.theme')` is `null` after render.
5. Tests with a stored value of `purple`, with `localStorage.getItem` throwing, with `localStorage.setItem` throwing on click, and with `window.matchMedia` undefined: render does not throw, the theme is a valid value, and in the setItem case the click still flips the theme.
6. A test picks a user, toggles to dark, switches user in the picker, and `data-theme` is still `dark`. The toggle button is present both before a user is picked and after.
7. A test reads `apps/web/index.html`, extracts the inline script, runs it against a stubbed `localStorage`/`matchMedia` for: stored `dark`, stored `light` with OS dark, nothing stored with OS dark, invalid stored value, and a throwing `localStorage`; it sets `data-theme` as in requirement 4 and never throws.
8. A test reads `App.css`, asserts no hex color appears outside the `:root` and `:root[data-theme='dark']` blocks, that the two blocks define the same set of custom properties, and that the light block's values equal the original hex values (the test lists them, see plan).
9. A test parses the custom properties from both blocks and asserts the contrast pairs listed in the plan reach at least 4.5:1 (3:1 for border and focus colors vs. the page background) in both themes.
10. `pnpm build` succeeds and, with the app running (`pnpm --filter @levelpath/web dev --port <w> --strictPort` and the API), in a browser with OS dark mode and no stored choice the page is dark on first paint with no light flash; the toggle switches to light, a reload stays light, and switching user keeps it. The verifier checks the user list, new-request form (Suggest fields), an approver's decision queue, an error alert and a disabled button in both themes.
11. `git diff --stat origin/main` shows changes only under `apps/web/`, `docs/`, and the job folder; none under `apps/api`, `packages/shared`, `db/`.

## Tenant isolation and security

Not affected: the theme is a browser-local preference in `localStorage`, holds no tenant data, and no API, query or RLS path changes. The inline script reads only `localStorage` and `matchMedia`, takes no input from the URL or server, and writes only the literal `light`/`dark` attribute values. `X-User-Id` handling is untouched.

## Out of scope

- Per-tenant branding or palettes; server-side or cross-browser storage.
- A "System" option to return to OS-following; a keyboard shortcut.
- A UI library, CSS framework, or any restyling of the light theme or layout.
- Changes to `apps/api`, `packages/shared`, `db/`, or protected paths.

## Assumptions

- Storage key `levelpath.theme`, values `light`/`dark`, mirroring `levelpath.userId`.
- The OS preference is read once at load; no live listener for OS changes while the page is open (the issue only asks for the first-visit default).
- The button shows its action phrase as visible text (no icon), so the visible label and the accessible name match.
- The dark palette is the plan's; reviewers may adjust values only if the contrast test still passes.
