# Page footer with app name and current year

> Issue #1: Add a page footer with the app name and the current year · Type: feature

## Summary

- Add a `<footer>` after `<main>` in the web app reading "Levelpath Demo · <year>".
- The year comes from `new Date()` at render time.
- Muted, small, centred text that fits at phone width.
- Add a web test with faked system time.

## Context

`apps/web/src/App.tsx` renders a single `<main>` with no router, so a footer in `App` appears on every page. Styles are in `apps/web/src/App.css`. Tests are in `apps/web/src/App.test.tsx` (Vitest, Testing Library).

## Requirements

1. `App` renders a `<footer>` after `<main>` containing the text `Levelpath Demo · <current year>`.
2. The year is computed with `new Date().getFullYear()` during render, not hard-coded.
3. The footer is small, muted (but still readable contrast), centred, and has no horizontal overflow at 320px width.
4. A web test checks the footer text for a faked date.

## Acceptance criteria

1. Run `pnpm --filter @levelpath/web test`. A new test fakes the system time to 2031-06-15, renders `App` and finds the `contentinfo` role with the text `Levelpath Demo · 2031`. It passes.
2. The test fails if the year is hard-coded. Setting a different faked year gives a different footer text.
3. Open the web app (`pnpm --filter @levelpath/web dev --port <w> --strictPort`). The footer shows "Levelpath Demo · 2026" (or the current year) below the content. It is centred and in smaller, grey text.
4. At 320px viewport width the footer text is visible and the page doesn't scroll horizontally.
5. The existing App tests still pass.

## Tenant isolation and security

Not affected. This is static UI text with no data, API or user input.

## Out of scope

- API, shared-package or database changes.
- Layout changes beyond the footer, and a router or layout component.

## Assumptions

- The separator is the middle dot `·` with spaces, as in the issue example.
- The year uses the local timezone via `getFullYear()`, which is fine for a display-only footer.
- A semantic `<footer>` outside `<main>` gets the implicit `contentinfo` role.
