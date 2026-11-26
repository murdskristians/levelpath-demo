# Edit a draft purchase request before submitting it

> Issue #41: Intent: Edit a draft purchase request before submitting it · Type: feature

## Summary

- New route `PUT /purchase-requests/:id` replaces the editable fields of the caller's own draft. Body: the same fields and rules as create.
- Only the requester who created it can edit, and only while it is a `draft`. Everyone else gets the same 404 as for an id they can't see. A non-draft gets 409.
- "My requests": each draft gets an Edit button next to Submit. It opens the same form, pre-filled. Save keeps the draft's status and refreshes the list. Cancel changes nothing.
- No migration. The shared contract and `docs/specs/purchase-requests-contract.md` gain the new route.

## Context

- `apps/api/src/purchase-requests/purchase-requests.service.ts`: `submit` is the pattern (`requester_id` filter, 404 when not found, 409 when not a draft, conditional `UPDATE` inside `withTenant`). `create` maps a foreign-key violation (unknown or other-tenant supplier) to 404.
- `apps/api/src/purchase-requests/purchase-requests.controller.ts`: the routes. `packages/shared/src/purchase-requests.ts`: `createPurchaseRequestSchema` (strict, so a client can't send `id`, `status`, `tenantId`, `requesterId`).
- `db/migrations/0003_purchase_requests.sql`: RLS `tenant_isolation` with `USING` and `WITH CHECK` on `tenant_id`, forced; the app role has `SELECT, INSERT, UPDATE, DELETE`. Migration 0005 added `description` and `category` under the same policy. An UPDATE of the edited columns needs nothing new.
- `apps/web/src/App.tsx` (`Dashboard`), `components/NewRequestForm.tsx` (form, Suggest fields), `components/RequestList.tsx` (Submit button), `api.ts` (`createApi`, `call` accepts only GET and POST today).

## Requirements

1. `packages/shared` exports `updatePurchaseRequestSchema` and the types `UpdatePurchaseRequest` and `UpdatePurchaseRequestInput`, with exactly the fields and rules of `createPurchaseRequestSchema` (strict).
2. `PUT /purchase-requests/:id` with an `UpdatePurchaseRequest` body, for any authenticated user, answers `200 PurchaseRequest` (the updated request, status still `draft`) when the caller is the request's requester and its status is `draft`.
3. It sets `title`, `amount_cents`, `currency`, `supplier_id`, `category`, `description` and `updated_at`. It changes nothing else: not `status`, `requester_id`, `tenant_id`, `id`, `created_at`.
4. A caller who is not the requester (another requester, an approver, a caller in another tenant using a crafted id), an unknown id and a non-UUID id all get the same `404 {"statusCode":404,"message":"Not Found"}`. An unknown or other-tenant `supplierId` is a 404 too, as for create.
5. A request whose status is not `draft`, edited by its own requester, gets 409. A request that changes status between the check and the write also gets 409 and is not changed.
6. An invalid body (bad title, amount, currency, category, supplier id, or an extra key such as `status`, `id` or `tenantId`) gets 400 with `issues`, as for create.
7. A refused edit (400, 404, 409) leaves the row exactly as it was, `updated_at` included.
8. The tenant and the caller come from `@CurrentUser()`; all database work runs through `withTenant`.
9. `docs/specs/purchase-requests-contract.md` lists the new route, its errors and the new shape.
10. In "My requests" every draft shows an Edit button next to Submit, with an accessible name `Edit <title>`. Non-drafts have none.
11. Clicking Edit opens the same form as New request, with title, category, amount, currency, supplier and description filled from the draft (the amount as text such as `1250.00`). The form is named "Edit request", the save button "Save changes". No other form is shown at the same time.
12. Save validates with the shared schema (same messages as create), sends `PUT /api/purchase-requests/<id>`, closes the form and re-fetches the list, which shows the new values and the status `Draft`. It does not submit.
13. Cancel closes the form, sends no request and leaves the list unchanged.
14. Suggest fields works in the edit form exactly as in the create form.
15. An API error on save (for example 409) is shown in the existing error alert, as for other actions.

## Acceptance criteria

1. `pnpm --filter @levelpath/shared test` (shared spec): `updatePurchaseRequestSchema` accepts a valid body, defaults currency to `EUR` and description to `''`, and rejects `status`, `id`, `tenantId`, `requesterId` keys and the same invalid values create rejects.
2. API, Alice (Acme requester) creates a draft, then `PUT /purchase-requests/<id>` with new values as Alice: 200, the body parses with `purchaseRequestSchema`, shows the new values, `status` is `draft`, `requester.id` is Alice, `id` and `createdAt` unchanged; in the database `updated_at > created_at` and `status = 'draft'`. A later `GET /purchase-requests/mine` shows the same values.
3. API, a body with `description` left out and `currency` left out stores `''` and `EUR` (same defaults as create).
4. API, each of these answers exactly 404 `{"message":"Not Found","statusCode":404}` with identical response text, and the row (read as owner) is unchanged: Amir (approver, Acme) editing Alice's draft; another requester in the same tenant editing a draft (create one as Amir, edit as Alice); Bella (Globex) editing an Acme draft's id; an unknown UUID; `not-a-uuid`.
5. API, editing own draft with another tenant's supplier id, or an unknown supplier id: 404, row unchanged.
6. API, Alice editing her own submitted request and her own approved request (seeded `purchaseRequests[1]` and `[2]`): 409, row unchanged. A draft she submitted, then edits: 409.
7. API, Amir (approver) creates his own draft and edits it: 200 (he is its creator). Amir editing Alice's draft is criterion 4.
8. API, invalid bodies (empty title, negative amount, amount over the maximum, lowercase currency, unknown category, non-UUID supplier, and extra keys `status`, `id`, `tenantId`, `requesterId`): 400 with `issues`, row unchanged and still `draft`.
9. API, no `X-User-Id`: 401.
10. API, the seeded rows are unchanged after the file runs (use `seededRequestsSnapshot`).
11. Web, `pnpm --filter @levelpath/web test`: a draft shows `Edit Laptops` next to `Submit Laptops`; a submitted request shows neither.
12. Web, clicking Edit shows a form named "Edit request" whose Title, Category, Amount, Currency, Supplier and Description hold the draft's values, with `Save changes` and `Cancel`, and no "New request" button.
13. Web, changing the title and clicking Save changes sends one `PUT /api/purchase-requests/<id>` with the validated body and `X-User-Id`, no POST, closes the form, re-fetches `/purchase-requests/mine` and shows the new title with `Draft`.
14. Web, Save with an empty title shows the title error and sends nothing.
15. Web, Cancel sends no request, closes the form and shows the old values.
16. Web, in the edit form Suggest fields posts `/purchase-requests/suggestion` and fills and tags fields as in create.
17. Web, a 409 on save shows the error alert and keeps the form open.
18. Manual check with the mock LLM: run the app on chosen ports, pick Alice, create a draft, click Edit, change the amount, Save: the list shows the new amount and `Draft`; click Submit: it becomes `Submitted`.

## Tenant isolation and security

- The update runs in `withTenant(user.tenantId, …)`, so RLS (`USING` and `WITH CHECK` on `tenant_id`) limits it to the caller's tenant. The `WHERE` also requires `requester_id = user.userId` and `status = 'draft'`, so a request the caller may not edit is indistinguishable from one that doesn't exist.
- The supplier is checked by the composite foreign key `(tenant_id, supplier_id)`, which rejects another tenant's supplier; the violation becomes a 404, as in create.
- The body schema is strict: the client can't send status, requester, tenant or id. `tenant_id` and `requester_id` are never in the `SET`.
- A test proves tenant B (Bella) can't update tenant A's draft with a crafted id, and that Alice can't edit Amir's draft.
- `X-User-Id` stays a dev stub, not authentication. No new PII is logged.

## Out of scope

Deleting drafts, edit history or audit trail, conflict checks between two open forms (last save wins), editing submitted, approved or rejected requests, resubmitting a rejected one, any migration, and any change to Suggest fields behaviour.

## Assumptions

- **Method and shape:** `PUT /purchase-requests/:id` with all fields (full replacement, same body as create), not `PATCH`. The issue says "every field the create form has", so a partial body is not needed.
- **Approver's own draft:** the rule is "the creator, while it is a draft", so an approver can edit a draft they created themselves. Approvers editing anyone else's draft get 404.
- **Order of checks:** body validation runs before the lookup, as in create, so an invalid body on an unseen id answers 400, which reveals nothing about the id.
- **Wording:** `Edit <title>` (button), `Edit request` (form name), `Save changes`, `Cancel`. The form appears where the new-request form does, above the list.
- **Edit while the form is open:** clicking Edit on another draft switches the form to that draft, and discards unsaved input of the previous form.
