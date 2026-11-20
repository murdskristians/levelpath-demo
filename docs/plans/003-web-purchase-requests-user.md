# Plan: Web purchase-request screens

> Spec: factory/jobs/003-web-purchase-requests-user/spec.md · Type: feature

## Approach

Plain React state and hooks; no router or state library. One small typed API client (`api.ts`) wraps `fetch`, adds `X-User-Id`, parses responses with the shared schemas and throws a typed `ApiRequestError`. `App` holds the selected user id and renders a `Dashboard` keyed by that id, so switching users unmounts and resets everything. Tests mock only `global.fetch`.

## Libraries and versions

Checked 2026-11-20:

- `@levelpath/shared` (workspace, ESM) and `zod` `^4.6.7` (the version `packages/shared` uses): add `zod` to `apps/web` dependencies for the `/me` schema. Run `pnpm view zod dist-tags peerDependencies` when installing and keep the major in step with shared.
- React 19, Testing Library react 16 and dom 10, vitest 5 and vite 8 are already in `apps/web/package.json`.
- No `@testing-library/user-event`: use `fireEvent`. (If wanted: latest 14.6.13, peer `@testing-library/dom >=7.21.4`, satisfied.)

## Files

- `apps/web/package.json` — add `zod`.
- `apps/web/vite.config.ts` — `/api` proxy with rewrite stripping `/api`, target from `API_PORT` (default 3000); expose a small pure helper so a test can check it.
- `apps/web/src/App.tsx` — header, picker, dashboard.
- `apps/web/src/App.css` — badge, form, error and 320 px styles.
- `apps/web/src/App.test.tsx` — update the placeholder tests (disabled button and static empty text no longer hold; keep heading and footer tests, now with `fetch` mocked).
- `pnpm-lock.yaml` — from install.
- `docs/LEARNING.md` — short entry: building against a contract with a mocked `fetch`.
- `CLAUDE.md` — one line in Architecture on the web app's proxy and dev user picker.

### New files

- `apps/web/src/api.ts` — `createApi(userId)` with `getMe, getSuppliers, getMine, getToDecide, createRequest, submit, decide`; `ApiRequestError {status, message, issues}`; local `meSchema`.
- `apps/web/src/users.ts` — the four seeded users; `loadUserId` and `saveUserId` over `localStorage`.
- `apps/web/src/money.ts` — `formatAmount(cents, currency)` and `parseAmountToCents(text)` (string based, no float math).
- `apps/web/src/components/` — `UserPicker.tsx`, `RequestList.tsx` (with the status badge), `NewRequestForm.tsx`, `DecisionQueue.tsx`, `ErrorAlert.tsx`.
- `apps/web/src/test/fixtures.ts` — schema-valid fixture builders (they parse with the shared schemas) and a `mockFetch(routes)` helper that records calls.
- Tests next to the code: `money.test.ts`, `api.test.ts`, `vite.config.test.ts`, component and App tests.

## Steps

### 1. Foundations

- Add `zod` to `apps/web`; `pnpm install`.
- `users.ts`, `money.ts` with tests (`12.34`→1234, `0.29`→29, `1.15`→115, `-1`, `abc`, `1,5` invalid; formatting).
- The proxy in `vite.config.ts` with `vite.config.test.ts` (criterion 15).
- `api.ts` with `api.test.ts`: header sent, parse failure throws, the error body's `message` is surfaced, a non-JSON error body falls back to the status text, network failure is wrapped. Write `test/fixtures.ts`.

### 2. Shell and list

- `App.tsx`: `userId` from `loadUserId()`; `UserPicker` in the header with the visible "Development stub, not a login" note; with no user, show the prompt and fetch nothing. `<Dashboard key={userId}>` loads `/me` (name and company) and `mine`; a 401 shows the "pick a user" message.
- `RequestList`: empty state, status badge, decision and comment, Submit for drafts.
- Tests for criteria 1 to 6, 12 to 14.

### 3. Form

- `NewRequestForm`: labelled controlled inputs, `aria-invalid` and `aria-describedby` on error text, suppliers from `/suppliers`. Build `{title, amountCents, currency, supplierId}` (amount through `parseAmountToCents`; an unparseable amount gives an amount error), `safeParse` with `createPurchaseRequestSchema`, map issues by `path[0]` to fields. The old disabled button becomes the opener. Tests for criteria 7 and 8.

### 4. Approver queue

- `DecisionQueue` only when `me.user.role === 'approver'`; `decisionSchema.safeParse` before sending; the error shows beside the comment box. Tests for criteria 9 to 11.

### 5. Styles and docs

- CSS: contrast pairs of at least 4.5:1 (existing `#1a1a1a`/`#fff`, `#4b5563`/`#fff`, `#fff` on `#1d4ed8`; pick badge colours and note their ratios), controls at `width: 100%`, header that wraps at 320 px, visible focus.
- `CLAUDE.md` line and `docs/LEARNING.md` entry.

### 6. Validate

Run the validation commands.

## Tests

All with Testing Library and `fetch` mocked by route; fixtures parse with the shared schemas. Cover criteria 1 to 16. After each test: `cleanup`, clear `localStorage`, restore `fetch`. The footer test keeps working.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

If the API job has merged, run both apps on chosen ports (see CLAUDE.md) and check `curl -H "X-User-Id: a0000000-0000-4000-8000-000000000101" localhost:<web>/api/me` returns Alice and Acme Corp through the proxy.

## Notes

- Do not touch `apps/api` or `packages/shared`. To run the web app alone, `pnpm --filter @levelpath/shared build` first.
- `apps/web` uses bundler resolution: relative imports need no `.js` suffix (unlike the API).
- Avoid races: use an ignore flag or `AbortController` in effects so a late response from the previous user is dropped.
- `pnpm lint` is a Prettier check only: run `pnpm exec prettier --write` on the new files before finishing.
