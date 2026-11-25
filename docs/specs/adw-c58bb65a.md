# Light/dark theme toggle

> Issue #27: Intent: Light/dark theme toggle · Type: feature · Intent: none in `docs/intent/` (the issue body is the intent)

## Summary

- Add a dark theme to the web app. The light theme stays exactly as it looks today.
- With no stored choice, the app follows the OS `prefers-color-scheme`.
- One header button, next to the user picker, switches light and dark. The choice is stored in `localStorage` and then wins over the OS, across reloads and user switches.
- The theme is applied before first paint, so the page never flashes the wrong theme.
- Web only (`apps/web`). No API, `packages/shared` or `db/` change.

## Context

- `apps/web/src/App.css` holds every color as a hard-coded hex (about 34 values) and has no custom properties.
- `apps/web/src/App.tsx`: `App` builds `picker = <UserPicker …/>` and renders it inside `<header>` in two places: `Dashboard` (user picked) and the no-user branch. The footer is outside both.
- `apps/web/src/components/UserPicker.tsx` renders the user `<select>` and a note.
- `apps/web/src/users.ts` shows the localStorage pattern: a key (`levelpath.userId`), a `load…`/`save…` pair.
- `apps/web/index.html` has no inline script. `apps/web/src/App.test.tsx` clears `localStorage` after each test and reads `src/App.css` in a `styles` block (form controls `width: 100%`, no fixed width above 320px). Both must keep passing.
- Vitest runs in jsdom, which has no `matchMedia` unless a test stubs it.

## Requirements

1. All colors in `App.css` come from CSS custom properties defined once for the light theme (values identical to today's hex values) and once for the dark theme. No hex value is left in the rules that use them.
2. The theme is selected by a `data-theme="light" | "dark"` attribute on `<html>`, plus `color-scheme` set to match so native controls follow.
3. With no valid stored choice, the theme is the OS `prefers-color-scheme` result (dark if it matches, otherwise light). A stored choice, once present, wins over the OS. Without a stored choice, the OS setting is followed.
4. A button in the header, next to the user picker, switches light ↔ dark. Its accessible name says what pressing it does: `Switch to dark theme` when light is active, `Switch to light theme` when dark is active. Its visible label may differ.
5. Pressing it applies the new theme at once and stores `light` or `dark` under the `localStorage` key `levelpath.theme`. A missing, unreadable or invalid stored value counts as no choice.
6. The choice survives a reload and switching users in the picker, and the button exists in both header variants (no user picked, and a user picked).
7. `apps/web/index.html` sets `data-theme` on `<html>` from the same rule in a small inline script in `<head>`, before the body renders, so there is no flash. If `localStorage` or `matchMedia` throws, the script falls back to light.
8. Both themes meet WCAG AA: 4.5:1 for text, and 3:1 for control borders and the focus ring against the page background. This covers the header, request list and badges, new-request form (including Suggest fields and the suggested tag), decision queue, error alerts, field errors, empty state, footer and notes, and the disabled button. Disabled text is held to 4.5:1 as well, as a self-imposed bar.
9. The theme button reuses the existing global `button` style, with a `theme-toggle` class that only adjusts spacing. On narrow screens it may be full-width like every other button.
10. Tests in `apps/web` cover the toggle, the stored choice, the OS default and the contrast of the palette.

### Dark palette (the planner's pick; contrast on the dark page background `#111827`)

| Token use                          | Dark value                                     | Contrast   |
| ---------------------------------- | ---------------------------------------------- | ---------- |
| page background                    | `#111827`                                      |            |
| text                               | `#f3f4f6`                                      | 16:1       |
| muted text (footer, notes)         | `#d1d5db`                                      | 12:1       |
| primary button bg / text           | `#60a5fa` / `#0b1220`                          | 7.6:1      |
| secondary button bg / text         | `#111827` / `#93c5fd`                          | 9:1        |
| disabled button bg / text / border | `#374151` / `#d1d5db` / `#4b5563`              | 7:1 text   |
| input border, empty-state border   | `#9ca3af`                                      | 6.9:1      |
| divider (header, list items)       | `#374151`                                      | decorative |
| focus ring                         | `#93c5fd`                                      | 9:1        |
| badge draft                        | `#374151` / `#f3f4f6`                          | 8:1        |
| badge submitted, suggested tag     | `#1e3a8a` / `#dbeafe`                          | 8:1        |
| badge approved                     | `#14532d` / `#dcfce7`                          | 9:1        |
| badge rejected                     | `#7f1d1d` / `#fee2e2`                          | 8:1        |
| error alert                        | `#450a0a` bg, `#fecaca` text, `#f87171` border | 11:1       |
| field error text                   | `#fca5a5`                                      | 9:1        |

The builder must verify these figures with the contrast test (requirement 10) and adjust a value if it fails.

## Acceptance criteria

1. **Light is unchanged.** In `App.css`, the light-theme custom property values equal the hex values currently used for the same roles (for example text `#1a1a1a`, page `#ffffff`, primary `#1d4ed8`, error text `#7f1d1d`). Verify by diffing `git diff` of `App.css`: every removed hex reappears as a light value. In the browser with the OS in light mode and no stored choice, the page looks as it did before.
2. **OS default.** With `localStorage` empty and `matchMedia('(prefers-color-scheme: dark)')` matching, `document.documentElement.dataset.theme` is `dark` after render. With it not matching, it is `light`. Verify with a Vitest test that stubs `matchMedia`.
3. **Toggle.** Render `<App />`, find `getByRole('button', { name: 'Switch to dark theme' })`, click it. `data-theme` becomes `dark`, `localStorage.getItem('levelpath.theme')` is `dark`, and the button's name is now `Switch to light theme`. Clicking again returns to `light` and stores `light`.
4. **Stored choice wins.** With `levelpath.theme = light` stored and the OS matching dark, `data-theme` is `light`. With `dark` stored and the OS not matching, it is `dark`. A stored value `purple` is ignored and the OS rule applies.
5. **Survives user switches and reloads.** After toggling to dark, switch the user in the picker: `data-theme` stays `dark`. Unmount and render `<App />` again: it is still `dark`.
6. **Both headers.** The theme button is found inside `getByRole('banner')` both with no user picked and with a user picked.
7. **No flash.** `apps/web/index.html` contains an inline `<script>` in `<head>`, before the `main.tsx` module script, that sets `data-theme`. A test evaluates its text in jsdom against stubbed storage and `matchMedia` and checks the result for: no stored choice and dark OS (dark), no stored choice and light OS (light), stored `light` and dark OS (light), and `localStorage` throwing (light). In the built output `apps/web/dist/index.html`, the script is still inline.
8. **Contrast.** A Vitest test parses `App.css`, reads each light and dark foreground/background pair in the palette (text on page, muted on page, primary button, secondary button, disabled button, each badge, the suggested tag, the error alert, field error, and non-text pairs: input border, empty-state border and focus ring against the page) and asserts at least 4.5:1 for text and 3:1 for the non-text pairs.
9. **No hard-coded colors left.** A test or `rg '#[0-9a-fA-F]{3,6}' apps/web/src/App.css` shows hex values only inside the two theme blocks (`:root` / `[data-theme='dark']` or equivalent).
10. **Manual check.** On a dev server (`pnpm --filter @levelpath/web dev --port <w> --strictPort`, API running), with the picker on an approver, open the page, press the toggle, and see the header, the request list, the new-request form with Suggest fields, the decision queue, an error alert and the empty state all dark and readable. Reload: it stays dark with no light flash. Switch user: it stays dark.
11. The existing `styles` tests in `App.test.tsx` still pass without edits.

## Tenant isolation and security

Not affected. The choice is stored only in the browser's `localStorage` and never sent to the API. No tenant data, request, route, migration or RLS change. The inline script reads one storage key, writes nothing, and takes no input from the URL or the server. `X-User-Id` stays a dev stub.

## Out of scope

- Per-tenant branding or palettes; server-side or cross-browser persistence.
- A third "System" option to go back to following the OS.
- A keyboard shortcut for the toggle.
- A UI library, CSS framework or redesign of the current look. No changes to layout, spacing or fonts.
- Live updates when the OS setting changes while the app is open and no choice is stored (the OS is read on load).
- Changes to `apps/api`, `packages/shared`, `db/`, or any protected path.

## Assumptions

- The storage key is `levelpath.theme`, beside `levelpath.userId`.
- The button label is text-only (`Dark theme` / `Light theme`), with the full action in `aria-label`. No emoji or SVG: simplest and no extra assets. The accessible name is the `aria-label`.
- Following the OS is read once on load; it is not live-updated. This keeps the code small and matches "on a first visit".
- The button sits in the header under the picker note, inside `<header>`, rendered once from `App` in both header branches.
- The existing `button` style (blue, `margin-top: 1rem`) is reused with a small `theme-toggle` class that only adjusts spacing. This is a styling choice, not a redesign.
