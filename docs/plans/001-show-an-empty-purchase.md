# Plan: Show an empty purchase-requests list on the home page

> Spec: factory/jobs/001-show-an-empty-purchase/spec.md · Type: feature

## Approach

Edit `App.tsx` to render a `<section aria-labelledby>` with an `h2`, the empty-state text and a disabled button, styled by a small plain CSS file imported in `App.tsx`. Plain CSS over a framework or inline styles: no new dependency, and it supports `:disabled` and fluid layout cleanly.

## Libraries and versions

None. Uses React 19 and Vite 8 already in `apps/web/package.json`; Vite handles `.css` imports natively and Vitest processes them without extra config.

## Files

- `apps/web/src/App.tsx` — new markup, import `./App.css`.
- `apps/web/src/App.test.tsx` — updated tests.

### New files

- `apps/web/src/App.css` — layout and button styles.

## Steps

### 1. Markup and styles

- In `App.tsx`: keep `<main>` and `<h1>Levelpath Demo</h1>`; replace the `<p>` with
  `<section aria-labelledby="purchase-requests-heading">` containing `<h2 id="purchase-requests-heading">Purchase requests</h2>`, `<p>No purchase requests yet.</p>`, `<p>Requesters will create purchase requests here.</p>`, and `<button type="button" disabled>New request</button>`.
- Note: relative imports in `apps/web` follow the existing style (`./App` without `.js`); keep it.
- `App.css`: `main` with `max-width: 40rem; margin: 0 auto; padding: 1rem;` and `box-sizing: border-box`; body font and dark text (`#1a1a1a` on white, well over 4.5:1); empty-state block with a dashed border, padding and centred text; `overflow-wrap: anywhere`; button with padding, a solid enabled style, and `button:disabled { background: #e5e7eb; color: #4b5563; cursor: not-allowed; }` (still legible). Full-width button under 480px via a media query is optional.

### 2. Tests

- `App.test.tsx`: keep the h1 test; add tests for the h2 (`level: 2`), `getByText('No purchase requests yet.')`, the hint line, the disabled button (`getByRole('button', { name: 'New request' })` has `disabled`), and that "coming soon" is absent (`queryByText(/coming soon/i)` is null).

### 3. Validate

Run the validation commands below.

## Tests

- Component tests as in step 2. No data access, so no tenant isolation test applies.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

Plus: `pnpm --filter @levelpath/web dev --port <w> --strictPort`, open the page, check the empty state, the disabled button, and 320px width with no horizontal scroll; stop with `factory/bin/port stop <w>`.

## Notes

No `CLAUDE.md` or `docs/LEARNING.md` update is needed: no new concept. Prettier lint is check-only, so format the files with `pnpm exec prettier --write` on the changed files before finishing.
