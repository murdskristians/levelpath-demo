# Intent: Light/dark theme toggle

<!-- Written by /intent with Chris (2026-11-24), from "light-dark theme toggle" and Chris's four answers. -->

## Problem

The web app has one look: a white page with dark text. Every color is hard-coded in `apps/web/src/App.css` (about 34 hex values), so it ignores a user's OS dark-mode setting and offers no way to switch. Anyone working in a dark environment, or with dark mode set system-wide, gets a bright white page.

## Outcome

On a first visit the app matches the OS light/dark setting. A button in the header switches between light and dark, and that choice wins over the OS from then on in that browser, across reloads and user switches. Every screen reads well in both themes, and the page never flashes the wrong theme while it loads.

## Users and roles

- **Everyone who uses the web app:** `requester` and `approver`, in every tenant (Acme Corp and Globex Corp). The toggle and both themes are the same for all of them.
- **No tenant data:** the choice lives in the browser, not on the server, so tenants and RLS are not involved.

## Constraints

- **Decided (Chris):**
  - **Default:** follow the OS preference (`prefers-color-scheme`) until the user presses the toggle; after that the user's choice wins.
  - **Toggle:** one button in the header, next to the user picker, switching light ↔ dark. Its accessible name says what it does.
  - **Persistence:** per browser, in `localStorage`. It survives reloads and switching users in the header picker. No API, database or migration change.
  - **Done bar:** every current screen is themed: header, request list, new-request form (Suggest fields included), decision queue, error alerts, empty states and disabled buttons. Text and controls meet WCAG AA contrast in both themes. No flash of the wrong theme on load.
- **From the repo:**
  - **The light theme looks as it does today.** This adds a dark theme and the toggle; it does not restyle anything.
  - **Plain CSS:** custom properties in the existing stylesheet, no UI library or CSS framework.
  - **Web only:** `apps/web`. The API, `packages/shared` and `db/` don't change.
  - **Tests:** the toggle and the stored choice are covered by Vitest + Testing Library tests in `apps/web`.

## Out of scope

- Per-tenant branding, palettes or logos: one light and one dark theme for everyone.
- Remembering the theme per user on the server, or across browsers.
- A third "System" option to go back to following the OS once the user has chosen (clearing site data does it).
- A keyboard shortcut for the toggle (the button is reachable by keyboard like any other).
- A new UI library or CSS framework, and any redesign of the current look.

## Open questions

- The exact dark palette (the planner picks colors that meet AA and lists them).
- The button's label and icon (text, emoji or inline SVG), as long as its accessible name is clear.
