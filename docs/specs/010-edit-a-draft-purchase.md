# Edit a draft purchase request

> Issue #46: Edit a draft purchase request before submitting it · Type: feature · Intent: none (the issue body is the intent)

## Summary

- A new route `PATCH /purchase-requests/:id` replaces the six create fields of the caller's own draft and keeps it a draft.
- It takes the same body as create, validated with the same shared Zod schema. Only the requester who created the request can use it, and only while it is a draft.
- Every refusal changes nothing: a request the caller can't see is the same 404 as elsewhere, a non-draft is 409, a bad body is 400.
- In "My requests", each draft gets an Edit button next to Submit. It opens the new-request form pre-filled; Save changes updates the list, Cancel leaves the draft alone.
- No migration: the existing table, RLS policy and grants (`SELECT, INSERT, UPDATE, DELETE` for the app role) cover it.

## Context

- API: `apps/api/src/purchase-requests/` has `purchase-requests.controller.ts` (list, create, submit, decision), `purchase-requests.service.ts` (all through `DatabaseService.withTenant`) and `purchase-request.query.ts` (`selectPurchaseRequests`, `toPurchaseRequest`). `submit` is the model: UUID check, select by `id` and `requester_id`, 404 if missing, 409 if not a draft, an UPDATE conditional on `status = 'draft'`, then a read back. `create` maps a composite-FK violation (unknown or other-company supplier) to 404 with `isKeyViolation`.
- Shared: `packages/shared/src/purchase-requests.ts` holds `createPurchaseRequestSchema` (strict, so `id`, `status`, `tenantId` and `requesterId` are rejected).
- Contract: `docs/specs/purchase-requests-contract.md` lists the routes.
- Web: `apps/web/src/App.tsx` (the `Dashboard`, with `formOpen`), `components/NewRequestForm.tsx` (create form, Suggest fields), `components/RequestList.tsx` (Submit button on drafts), `api.ts` (`createApi`, whose `call` only knows `GET` and `POST`).
- Tests: API specs in `apps/api/src/purchase-requests/*.spec.ts` run over real HTTP against a per-run database (`apps/api/test/helpers.ts`: `startApp`, `SEED`, `ownerClient`, `deleteRowsTestsCreated`, `seededRequestsSnapshot`); web tests in `apps/web/src/App.test.tsx` with `test/fixtures.ts`.

## Requirements

1. `PATCH /purchase-requests/:id` with a `CreatePurchaseRequest` body (title, amountCents, currency, supplierId, category, description) updates those six columns of the request and `updated_at`, and returns `200 PurchaseRequest` with status `draft`.
2. It is allowed only for the caller who is the request's requester, and only while the status is `draft`. Nothing else about the row changes (status, requester, tenant, id, `created_at`).
3. Any request the caller did not create (another requester's, an approver's view of someone else's draft, another tenant's, an unknown id, a non-UUID id) answers the same `404 {"statusCode":404,"message":"Not Found"}`, as `submit` does.
4. A request of the caller's own that is not a draft answers `409`.
5. A body that fails `createPurchaseRequestSchema` (including extra keys such as `status`, `id`, `tenantId`, `requesterId`) answers `400`; a supplier that is unknown or another company's answers `404`, as create does.
6. A refused edit writes nothing: the row, including `updated_at`, is unchanged.
7. The tenant and the user come from the session (`@CurrentUser()`), never from the body, query or path. The query runs inside `withTenant`.
8. The shared contract has an exported `updatePurchaseRequestSchema` (the same shape as create) and `docs/specs/purchase-requests-contract.md` lists the route.
9. Web: every draft in "My requests" has an Edit button next to Submit, with accessible name `Edit <title>`. Non-drafts have none.
10. Clicking Edit opens the same form as New request, in the same place (above the list), filled with the draft's description, title, category, amount, currency and supplier. Its heading-less form is named `Edit request`, its save button `Save changes` and its cancel button `Cancel`.
11. Save changes validates with the shared schema, calls `PATCH`, closes the form and re-fetches "My requests". The draft keeps its Draft badge and shows the new values. A failed save shows the API error in the existing alert and keeps the form open.
12. Cancel closes the form without any call to the API.
13. "Suggest fields" works in the edit form exactly as in the new-request form.
14. The web API client has `updateRequest(id, input)` that sends `PATCH /api/purchase-requests/:id` and parses the response with `purchaseRequestSchema`.
15. Tests: API tests for the success path, each refusal and "a refused edit changes nothing"; web tests for the Edit button, the pre-filled form, save and cancel.

## Acceptance criteria

1. As Alice (`a0000000-0000-4000-8000-000000000101`) create a draft, then `curl -X PATCH -H "X-User-Id: <alice>" -H "Content-Type: application/json" -d '{"title":"New title","amountCents":2500,"currency":"USD","supplierId":"<2nd Acme supplier>","category":"software","description":"fixed"}' localhost:<port>/purchase-requests/<id>` answers 200; the body parses with `purchaseRequestSchema`, has the new values, `status` `draft`, the same `id`, `requester` and `createdAt`, and a later `updatedAt`. `GET /purchase-requests/mine` shows the new values. (API test.)
2. The same call omitting `currency` and `description` stores `EUR` and `""` (create's defaults). (API test.)
3. Amir (`a0000000-0000-4000-8000-000000000102`, approver) editing Alice's draft, Alice editing Amir's draft, Alice editing a Globex request id (`b0000000-0000-4000-8000-000000000301`), an unknown UUID and `not-a-uuid` all answer `404` with the identical body `{"statusCode":404,"message":"Not Found"}`; the owner-role rows are unchanged. (API test.)
4. Alice editing her own submitted request (seed `a…302`) and her own approved request (seed `a…303`) answers `409`; the row is unchanged, including `updated_at`. (API test.)
5. Alice editing her own draft with each of: empty title, negative amount, `currency: "eur"`, a non-UUID `supplierId`, an unknown category, and extra keys `status`, `id`, `tenantId`, `requesterId` answers `400` with an `issues` list; the row is unchanged. (API test.)
6. Alice editing her own draft with a Globex supplier id or an unknown supplier UUID answers `404`; the row is unchanged. (API test.)
7. A request without `X-User-Id` answers `401`. (API test.)
8. A tenant-isolation test: a Globex requester sending an edit for an Acme draft id gets the 404 of criterion 3, and an owner-role query shows the Acme row is untouched. The seeded rows are unchanged after the whole file (`seededRequestsSnapshot`). (API test.)
9. In the web app as Alice, a draft row shows buttons `Edit <title>` and `Submit <title>`; a submitted, approved or rejected row shows neither. (Web test.)
10. Clicking `Edit <title>` shows a form named `Edit request` above the list, with Description, Title, Category, Amount (as `12.34` text), Currency and Supplier set to the draft's values, a `Save changes` button and a `Cancel` button, and no `Create request` button. The `New request` button is not shown while the form is open. (Web test.)
11. After changing the title and clicking `Save changes`, exactly one `PATCH /api/purchase-requests/<id>` is sent with `{"title":…,"amountCents":…,"currency":…,"supplierId":…,"category":…,"description":…}`, the form closes, `GET /purchase-requests/mine` is re-fetched, and the list shows the new title with the Draft badge. (Web test.)
12. Clicking `Cancel` closes the form and sends no request; the list is unchanged. (Web test.)
13. Saving a title that is empty shows the field error next to Title and sends no `PATCH`. A `409`/`404` reply from `PATCH` shows the API message in the alert and keeps the form open. (Web test.)
14. In the edit form, with a description typed, `Suggest fields` sends one `POST /api/purchase-requests/suggestion`, fills and tags the fields as in the new-request form, and sends no `PATCH` until Save changes is clicked. (Web test.)
15. Opening `New request` after closing an edit shows an empty form (no leftover values); clicking Edit on a second draft shows that draft's values. (Web test.)
16. `docs/specs/purchase-requests-contract.md` has a `PATCH /purchase-requests/:id` row (who: its requester; body `CreatePurchaseRequest`; success `200 PurchaseRequest`, status `draft`; errors 400, 401, 404, 409). (Read the file.)
17. `git diff --stat origin/main -- db/` is empty (no migration).

## Tenant isolation and security

- The write goes through `DatabaseService.withTenant(user.tenantId, …)` as the non-owner app role, so RLS (enabled and forced on `purchase_requests`) hides other tenants' rows from both the SELECT and the UPDATE. A crafted id from another tenant matches no row and answers 404.
- Ownership is checked in the query (`requester_id = user.userId`), and the UPDATE repeats `requester_id` and `status = 'draft'` in its WHERE so a concurrent submit can't be overwritten.
- The body is the strict create schema: the client can't send or change `status`, `requesterId`, `tenantId` or `id`. The UPDATE's `set` lists only the six fields and `updated_at`. The tenant and the user never come from the body, query or path.
- The supplier is checked by the existing composite foreign key `(tenant_id, supplier_id)`; its violation is a 404.
- `X-User-Id` stays a dev stub, not authentication.

## Out of scope

- Deleting or discarding a draft.
- An edit history or audit trail (only `updated_at` changes).
- A conflict check between two open forms (the last save wins).
- Editing a submitted, approved or rejected request, or resubmitting a rejected one.
- Any database change, and any change to `PUT`/partial-update semantics (the body is the full create body).

## Assumptions

- The route is `PATCH /purchase-requests/:id` with the full create body (all six fields, `currency` and `description` defaulting as in create), not a partial body: "the same body as create" and "same validation as creating".
- Ownership alone decides who may edit, as for `submit`. An approver can therefore edit a draft they created themselves, but never anyone else's; "an approver" in the issue's refusals is an approver editing a requester's draft (404).
- A refused edit for ownership or tenant reasons is 404 (the contract's rule); a non-draft of the caller's own is 409, the same as submit.
- Wording: `Edit`, `Save changes`, `Cancel`; the form is named `Edit request` and appears where the new-request form does. The new-request form's `Create request` button text stays for create.
- Only one form is open at a time: clicking Edit while the new-request form is open replaces it.
