# Edit a draft purchase request

> Issue #33: Edit a draft purchase request before submitting it · Type: feature · Intent: docs/intent/edit-draft-request.md

## Summary

- New route `PUT /purchase-requests/:id` replaces every create-form field of the caller's own draft. Status, requester, tenant and id never change.
- Only the creator, only while the request is a draft. Anyone else gets the same 404 as for an unseen id; a non-draft gets 409, like a second submit.
- "My requests": each draft gets an Edit button next to Submit. It opens the request form pre-filled; Save keeps the draft and refreshes the list; Cancel changes nothing.
- No migration. The shared create schema is reused as the body schema; the contract document gets the new route.

## Context

- `apps/api/src/purchase-requests/purchase-requests.controller.ts` and `purchase-requests.service.ts`: create, mine, to-decide, submit, decide. `submit` is the pattern (UUID check, select scoped to `requester_id`, 404/409, conditional update, `readBack`).
- `packages/shared/src/purchase-requests.ts`: `createPurchaseRequestSchema` (strict, trims, defaults currency `EUR` and description `''`).
- Table `purchase_requests`: RLS forced, `tenant_isolation` policy, the app role already has UPDATE (`db/migrations/0003_purchase_requests.sql`). The composite FK to suppliers rejects an unknown or other-tenant supplier (`isKeyViolation` -> 404, as in create).
- Web: `apps/web/src/App.tsx` (Dashboard, `formOpen`), `components/NewRequestForm.tsx`, `components/RequestList.tsx`, `api.ts`.
- Contract: `docs/specs/purchase-requests-contract.md`.

## Requirements

1. `PUT /purchase-requests/:id` takes the body of `POST /purchase-requests` (same schema, same validation) and answers `200 PurchaseRequest` with the new values.
2. It succeeds only when the request exists in the caller's tenant, was created by the caller, and has status `draft`. The status stays `draft`; `updated_at` is set to now; `id`, `tenant_id`, `requester_id`, `created_at` are untouched.
3. A non-UUID id, an unknown id, another tenant's request, another requester's request (draft or not) and an approver editing someone else's request all answer the identical 404 as submit does. Authentication is required (401 without `X-User-Id`).
4. A request of the caller's own that is not a draft answers 409 and changes nothing.
5. An invalid body (any create-schema violation, or an extra key such as `status`, `tenantId`, `id`, `requesterId`) answers 400 and changes nothing. A supplier that is unknown or belongs to another tenant answers 404 and changes nothing.
6. The web list shows an Edit button on each draft (accessible name `Edit <title>`, visible text "Edit"), next to Submit, and on no other status.
7. Edit opens the request form pre-filled with the draft's title, amount (as decimal text), currency, supplier, category and description. Its heading/accessible name says it edits a request, and its primary button reads "Save changes".
8. Save validates with the shared schema, sends `PUT`, closes the form and re-fetches the list, which shows the new values and status Draft. Cancel closes the form and sends nothing.
9. Suggest fields works in the edit form exactly as in the new-request form.
10. The API contract document lists the route, body and errors.

## Acceptance criteria

1. As Alice (`a0000000-0000-4000-8000-000000000101`), create a draft, then `curl -X PUT -H "X-User-Id: <alice>" -H "Content-Type: application/json" -d '{"title":"New","amountCents":500,"supplierId":<acme supplier>,"category":"software","description":"d"}' localhost:<p>/purchase-requests/<id>`: 200, body parses as `PurchaseRequest` with the new values, `status` `draft`, `id` and `createdAt` unchanged, `updatedAt` later; `GET /purchase-requests/mine` shows the same values. Verified by an API test.
2. Omitting `currency` and `description` in the PUT body sets `EUR` and `''` (full replacement, as create). API test.
3. The same PUT for a non-UUID id, an unknown id, a Globex request id (as Alice), another Acme requester's draft, and Amir (approver) on Alice's draft: all `404` with identical bodies `{"message":"Not Found","statusCode":404}`. The owner-connection row of each is unchanged. API test.
4. PUT on Alice's own submitted and approved seeded requests: `409`; the row (title, amount, status, `updated_at`) is unchanged. API test.
5. PUT with each of: empty title, negative amount, lowercase currency, category outside the list, description over 2000 characters, missing supplierId, and extra keys `status`, `tenantId`, `id`, `requesterId`: `400` and the row unchanged. A Globex supplier id for an Acme draft: `404`, row unchanged. API test.
6. PUT without `X-User-Id`: `401`. API test.
7. A tenant-isolation test: Globex's requester cannot edit an Acme draft with its crafted id (404, row unchanged), and Alice cannot edit a Globex draft. API test.
8. The seeded requests are unchanged after the test file runs (the existing `seededRequestsSnapshot` pattern).
9. Web: a draft shows a button named `Edit Laptops` next to `Submit Laptops`; a submitted or approved request shows no Edit button. Web test.
10. Web: clicking Edit shows a form with the draft's values (title, amount `1250.00` for 125000 cents, currency, supplier, category, description) and a "Save changes" button; changing the title and clicking Save sends one `PUT /api/purchase-requests/<id>` with the shared-schema body, closes the form, re-fetches `/purchase-requests/mine` and shows the new title. Web test.
11. Web: Cancel in the edit form closes it, sends no PUT, and the list is unchanged. An invalid value (empty title) shows the field error and sends nothing. Web tests.
12. Web: in the edit form, Suggest fields posts to `/purchase-requests/suggestion` and fills/tags fields as in the new-request form. Web test.
13. A shared-schema test or compile check: the update body type is the create schema (no new contract fields). `docs/specs/purchase-requests-contract.md` has a `PUT /purchase-requests/:id` row; check by reading it.

## Tenant isolation and security

All access is through `DatabaseService.withTenant(user.tenantId, ...)`; the tenant and requester come from `@CurrentUser()`, never from the body or URL. The update's WHERE includes `id`, `requester_id = caller` and `status = 'draft'`, under the forced `tenant_isolation` policy, so another tenant's row is invisible even with a crafted id. The strict schema refuses client-chosen id, tenant, status or requester. The supplier is checked by the composite FK. `X-User-Id` remains a dev stub, not authentication.

## Out of scope

Deleting drafts, edit history or audit trail, conflict detection (last save wins), editing non-draft requests or resubmitting a rejected one, any migration, any change to `.claude/` or `factory/`.

## Assumptions

- `PUT` (full replacement with the create body) rather than `PATCH`: the form always sends every field, so no new schema is needed.
- The creator may edit their own draft whatever their role (as with submit); "approvers can't edit" means approvers editing other people's requests, which is 404.
- Body validation (400) runs before the lookup, so an invalid body for an unknown id is a 400, as for other routes.
- The edit form replaces the new-request form in the same place above the list; the form is the same component with an edit mode.
