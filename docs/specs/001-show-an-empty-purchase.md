# Show an empty purchase-requests list on the home page

> Issue #2: Show an empty purchase-requests list on the home page · Type: feature

## Summary

- Replace the "Purchase requests, coming soon." line with a Purchase requests section showing its empty state.
- Section has an `h2`, the text "No purchase requests yet." plus one hint line, and a disabled "New request" button.
- Readable contrast and a fluid layout that works at phone width.
- Static UI only: no API calls, no data. Web test updated.

## Context

`apps/web/src/App.tsx` is an 8-line placeholder: a `<main>` with `<h1>Levelpath Demo</h1>` and `<p>Purchase requests, coming soon.</p>`. `apps/web/src/App.test.tsx` has one test checking the h1. `apps/web/index.html` already has the viewport meta tag. There is no CSS in the web app yet. `apps/web/src/main.tsx` renders `<App />`.

## Requirements

1. Keep the `h1` "Levelpath Demo".
2. Remove the "coming soon" line.
3. Add a section with an `h2` "Purchase requests".
4. Under it, show "No purchase requests yet." and one short line saying requesters will create purchase requests here.
5. Add a real `<button type="button">` labelled "New request" with the `disabled` attribute, visibly styled as disabled.
6. Text contrast meets WCAG AA (4.5:1 for body text; the disabled button is exempt by WCAG but must still be legible and visibly different from an enabled one).
7. The layout is fluid: no horizontal scroll at 320px width.
8. `App.test.tsx` keeps the h1 check and adds checks for the h2, the empty-state text and the disabled button.

## Acceptance criteria

1. Open the home page: it shows the h1 "Levelpath Demo" and, below it, an h2 "Purchase requests". The text "Purchase requests, coming soon." does not appear. Verify in the browser and with `screen.getByRole('heading', { level: 2, name: 'Purchase requests' })`.
2. The page shows "No purchase requests yet." and one further short line mentioning that requesters will create requests here. Verify visually and in the test with `getByText`.
3. `screen.getByRole('button', { name: 'New request' })` exists, is `disabled`, and clicking it does nothing. In the browser it looks greyed out and the cursor is `not-allowed`.
4. At a 320px-wide viewport (devtools device mode) there is no horizontal scrollbar and text does not overflow.
5. Body text colour against its background has a contrast ratio of at least 4.5:1 (check in devtools or by computing from the colours in the CSS).
6. The browser network tab shows no requests other than the page's own assets (no API calls).
7. `pnpm --filter @levelpath/web test` passes with the updated `App.test.tsx`, which fails against the old placeholder.

## Tenant isolation and security

Not affected: static markup, no data, no API, no auth, no input.

## Out of scope

- API calls, data fetching, a list component, or any state.
- The create flow (Phase 3), routing, a component library, or a CSS framework.
- Making the button do anything.

## Assumptions

- Hint line wording: "Requesters will create purchase requests here." Reason: the issue only asks for one short line to that effect.
- Styling goes in one plain CSS file imported by `App.tsx`; Vite handles it with no new dependency. Reason: smallest option that supports a disabled style and a fluid layout.
