# Web: purchase-request screens

> Issue #6: Web: purchase requests: user picker, my requests, new request, approver queue · Type: feature · Intent: docs/intent/purchase-requests.md

## Summary

- A header user picker (dev stub, four seeded users) drives `X-User-Id` on every call; the header shows who you are and the company from `GET /me`.
- "My requests" lists the caller's requests; drafts have Submit.
- A "New request" form, validated with `createPurchaseRequestSchema`, creates a draft.
- Approvers also see "Waiting for your decision" with Approve and Reject and a comment.
- Everything is built and tested against the contract with a mocked `fetch`. Nothing in `apps/api` changes.

## Context

- `apps/web/src/App.tsx` is a static placeholder with a disabled "New request" button; `App.test.tsx` tests it (heading "Levelpath Demo", h2 "Purchase requests", empty-state texts, footer `Levelpath Demo · <year>`). `apps/web/vite.config.ts` has no proxy. `apps/web/src/App.css` holds the styles.
- The contract is `docs/specs/purchase-requests-contract.md`; the schemas are in `packages/shared/src/purchase-requests.ts` (`supplierSchema`, `purchaseRequestSchema`, `createPurchaseRequestSchema`, `decisionSchema`, `apiErrorSchema`, `MAX_AMOUNT_CENTS`).
- `GET /me` exists (`apps/api/src/me/me.service.ts`) and returns `{ user: { id, name, role }, tenant: { id, name } }`. It has no shared schema, so the web app parses it with a small local Zod schema.
- Seeded users (`db/seed.sql`): Alice `a0000000-0000-4000-8000-000000000101` requester and Amir `a0000000-0000-4000-8000-000000000102` approver (Acme Corp); Bella `b0000000-0000-4000-8000-000000000101` requester and Boris `b0000000-0000-4000-8000-000000000102` approver (Globex Corp).

## Requirements

1. **Picker.** A labelled select in the header lists exactly Alice, Amir, Bella, Boris (with company and role). It is labelled visibly as a development stub, not a login. The choice is stored in `localStorage` and restored on load. With nothing stored, no user is selected and the page asks the user to pick one, without calling the API.
2. **Header identity.** From `GET /me` the header shows the user's name and company name.
3. **Header on every call.** Every API call goes to `/api/…` and sends `X-User-Id` with the selected id. Switching users clears the old data and re-fetches everything for the new user.
4. **My requests.** `GET /purchase-requests/mine`, rendered in API order (newest first). Each item shows the title, the amount formatted from `amountCents` in its currency (`Intl.NumberFormat`), the supplier name, a status badge (text, not colour alone), and the decision with its comment once present. An empty list shows a friendly empty state. A `draft` has a Submit button (`POST /purchase-requests/:id/submit`); on success the list refreshes.
5. **New request.** The "New request" button opens a form with title, amount (currency units, e.g. `12.50`), currency (default EUR) and supplier (a select from `GET /suppliers`). On submit the values are converted (amount to integer cents without float error) and validated with `createPurchaseRequestSchema`; field errors show next to their fields and nothing is sent. A valid form POSTs `{ title, amountCents, currency, supplierId }` to `/api/purchase-requests`, then closes and refreshes My requests. Cancel closes the form.
6. **Approver queue.** Only when `/me` says the role is `approver`: a "Waiting for your decision" section from `GET /purchase-requests/to-decide`, each item with a comment box, Approve and Reject. Both POST `{ decision, comment }` to `/purchase-requests/:id/decision`, validated with `decisionSchema` first. A rejection with an empty comment is blocked with a message next to the comment box and nothing is sent. For requesters the section is not rendered and `to-decide` is never called.
7. **Errors.** A non-2xx response shows the body's `message` in an alert region, and the rest of the page keeps working. A 400 `issues` list is shown when present. A 401 shows a message asking the user to pick a user. A network failure shows an error too.
8. **Validated responses.** Every response is parsed with the shared schemas (`purchaseRequestSchema`, `supplierSchema`) and, for `/me`, the local schema. A response that does not parse shows an error and none of its data.
9. **Proxy.** `apps/web/vite.config.ts` proxies `/api` to `http://localhost:${API_PORT}` (default 3000), stripping the `/api` prefix, so `/api/me` reaches `/me`.
10. **Accessible.** Every input has a label; actions are real `<button>`s; text contrast is at least 4.5:1; no horizontal scroll at 320 px.
11. **Tests** with Testing Library and a mocked `fetch`. The existing `App.test.tsx` tests that the new behaviour makes false (disabled button, static empty text) are updated.

## Acceptance criteria

1. Picker content: a test in `pnpm --filter @levelpath/web test` renders the app and finds a select labelled "User" with exactly the four options, and visible text saying it is a development stub and not a login.
2. Header and re-fetch: a test selects Alice; every mocked `fetch` call has a URL starting `/api/` and header `X-User-Id: a0000000-0000-4000-8000-000000000101`. It then selects Bella; `/me`, `/purchase-requests/mine` and `/suppliers` are fetched again with `b0000000-0000-4000-8000-000000000101`, and Alice's requests are no longer on screen.
3. Persistence: with `localStorage` holding Amir's id before render, the app fetches as Amir without any click; after choosing another user, `localStorage` holds the new id. With empty storage, `fetch` is not called and a "pick a user" prompt is shown.
4. Identity: after `/me` returns Alice at Acme Corp, the header shows "Alice" and "Acme Corp".
5. List: with two mocked requests they appear in the given order. A draft of `amountCents: 125000` in EUR shows `Intl.NumberFormat('en', {style:'currency',currency:'EUR'})` output for 1250 (the test computes the expected string with the same call), its supplier name, a "Draft" badge and a Submit button. A rejected one shows "Rejected" and its comment and no Submit button. An empty list shows the empty-state message.
6. Submit: clicking Submit on a draft POSTs to `/api/purchase-requests/<id>/submit` with the right header, then `mine` is fetched again and the new status is shown.
7. Form validation: opening the form with the "New request" button and submitting it empty shows an error next to the title field and sends no POST. An amount of `-1`, a non-numeric amount, a title over 200 characters, and a currency of `eur` each show an error next to their own field and send no POST.
8. Form request: filling title "Laptops", amount `12.34`, currency EUR and a supplier from the mocked `/suppliers`, then submitting, sends exactly one `POST /api/purchase-requests` with JSON body `{"title":"Laptops","amountCents":1234,"currency":"EUR","supplierId":"<id>"}`; the form closes and the new draft shows after the re-fetch. Amounts `0.29` and `1.15` send `29` and `115`.
9. Approver section: as Amir (approver) "Waiting for your decision" lists the `to-decide` items. As Alice the heading is absent and `to-decide` was never fetched.
10. Approve: clicking Approve POSTs `{"decision":"approved","comment":"<text or empty>"}` to `/api/purchase-requests/<id>/decision`, then the queue is fetched again.
11. Reject: clicking Reject with an empty comment sends nothing and shows "A rejection needs a comment." next to the box. With the comment "too dear" it POSTs `{"decision":"rejected","comment":"too dear"}`.
12. API error: a mocked 409 `{statusCode:409,message:"not a draft"}` on Submit shows "not a draft" in an element with `role="alert"`, and the lists stay on screen.
13. 401: a mocked 401 shows a message containing "pick a user".
14. Bad response: a mocked `mine` response that fails `purchaseRequestSchema` (for example a missing `supplier`) shows an alert and no request rows.
15. Proxy: a test imports the Vite config (or its proxy helper) and asserts `server.proxy['/api'].target` is `http://localhost:3000` when `API_PORT` is unset and `http://localhost:4567` when `API_PORT=4567`, and that the rewrite turns `/api/me` into `/me`.
16. Accessible: the tests find inputs with `getByLabelText`, actions with `getByRole('button', …)`, and the error region with `getByRole('alert')`. `apps/web/src/App.css` sets `width: 100%` (or `max-width: 100%`) on form controls and has no fixed width above 320 px. The builder lists the text/background colour pairs with their contrast ratios (all at least 4.5:1) in the PR description.
17. Optional, only when the API routes are on `main`: with both apps running on chosen ports, picking Alice shows "Alice" and "Acme Corp" and her seeded requests. Otherwise the mocked tests stand.
18. `git diff --name-only origin/main` lists only files under `apps/web/`, `pnpm-lock.yaml`, `CLAUDE.md` and `docs/`.

## Tenant isolation and security

Not affected on the server: no API, database or RLS change. The web app never sends a tenant id; the tenant comes from the server through `X-User-Id`. The picker is a dev stub and the UI says so; it is never presented as authentication. Server text is rendered as React text (no `dangerouslySetInnerHTML`). Responses are validated before use.

## Out of scope

- Any change to `apps/api` or `packages/shared`.
- Editing or deleting requests; real authentication; a router, a state library or a CSS framework.
- Mocking anything except `fetch` (`localStorage` is the real jsdom one).

## Assumptions

- `GET /me` is parsed with a local schema in `apps/web` (`{user:{id,name,role}, tenant:{id,name}}`), because it has no shared schema and `packages/shared` must not change. `zod` is added to `apps/web` for it.
- Without a stored user the app shows a "pick a user" prompt and calls nothing, rather than defaulting to Alice.
- A 403 on `to-decide` is not expected (the section is hidden for requesters) and uses the generic error display.
- The comment on Approve is optional; one comment box serves both buttons.
- Currency is a free 3-letter text input defaulting to `EUR`, as the contract's regex allows any code; the error tells the user to use upper case.
