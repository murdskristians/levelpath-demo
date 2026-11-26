# Edit a draft purchase request before submitting it

> Issue #42: Edit a draft purchase request before submitting it · Type: feature

## Summary

- New route `PATCH /purchase-requests/:id`: the requester who created a draft replaces its fields (same body and validation as create).
- Anyone else, in any tenant, gets the same 404 as for an unseen id; a request that is no longer a draft gets 409.
- "My requests": every draft gets an Edit button next to Submit. It opens the new-request form pre-filled; Save keeps the draft, Cancel changes nothing.
- No migration. The contract document is updated.

## Context

- `apps/api/src/purchase-requests/purchase-requests.controller.ts` and `purchase-requests.service.ts` hold `mine`, `to-decide`, `create`, `submit`, `decide`. `submit` is the model: a lookup by id and `requester_id` (404), a status check (409), a conditional update, `readBack`.
- `packages/shared/src/purchase-requests.ts` has the strict `createPurchaseRequestSchema` (title, amountCents, currency, supplierId, category, description).
- `purchase_requests` has RLS (forced) and `GRANT SELECT, INSERT, UPDATE, DELETE` to the app role (`db/migrations/0003_purchase_requests.sql`), so no migration is needed.
- Web: `apps/web/src/App.tsx` (Dashboard, `formOpen`), `components/NewRequestForm.tsx`, `components/RequestList.tsx`, `api.ts`. Contract: `docs/specs/purchase-requests-contract.md`.

## Requirements

1. `PATCH /purchase-requests/:id`, body = `UpdatePurchaseRequest`, which is the create body (same schema, same strictness, same defaults: currency `EUR`, description `''`). Success: `200 PurchaseRequest`.
2. It updates title, amount, currency, supplier, category, description and `updated_at` of the caller's own request while its status is `draft`. Status, requester, tenant, id and `created_at` never change.
3. A non-UUID id, an unknown id, another tenant's id, and a request the caller did not create (another requester, or an approver who is not its requester) are the same `404 {"statusCode":404,"message":"Not Found"}`.
4. A request that exists, is the caller's, and is not a draft: `409`. The status check is also in the UPDATE's `WHERE`, so a concurrent submit can't be overwritten.
5. An unknown or other-tenant `supplierId`: `404` (as create). An invalid body (including extra keys such as `status`, `id`, `tenantId`): `400` with `issues`. A missing caller: `401`.
6. Every refusal changes nothing in the database.
7. All data access is in `withTenant`; tenant and user come from `@CurrentUser()`.
8. Web: each draft in "My requests" has a button named `Edit <title>` (visible text "Edit") next to Submit. Non-drafts have none.
9. Edit opens the same form as New request, pre-filled with the draft's title, amount (as `12.50` text), currency, supplier, category and description. Its submit button is named "Save changes"; its form is named "Edit request".
10. Save validates with the shared schema, calls the new route, closes the form and reloads the list: the draft shows the new values and is still a Draft. Cancel closes the form with no request sent. Suggest fields works in the form as in create.
11. The shared contract doc is updated with the route, the errors and `UpdatePurchaseRequest`.

## Acceptance criteria

1. As Alice (`A.requester`), `PATCH /purchase-requests/<her draft>` with all six fields changed returns 200; the body has the new values, the same `id`, `status: "draft"`, the same `requester` and `createdAt`, and a later `updatedAt`. A following `GET /purchase-requests/mine` shows the new values. (API test.)
2. Omitting `currency` and `description` in the PATCH body sets them to `EUR` and `''`. (API test.)
3. Amir (Acme approver) PATCHing Alice's draft, Alice PATCHing Amir's draft, Alice PATCHing a Globex request id, a non-UUID and an unknown UUID all return 404 with an identical body; the rows read as the owner are unchanged. A Globex requester PATCHing Alice's draft id also gets 404. (API test.)
4. Alice PATCHing her submitted request and her approved request returns 409; PATCHing a draft after submitting it returns 409; the row is unchanged (including `updated_at`). (API test.)
5. Invalid bodies each return 400 and leave the row unchanged: empty title, title over 200, negative amount, non-integer amount, currency `eur`, bad `supplierId`, bad category, description over 2000, and an extra `status`, `id`, `tenantId` or `requesterId` key. (API test.)
6. A `supplierId` of a Globex supplier on an Acme draft returns 404 and leaves the draft unchanged. (API test.)
7. PATCH without `X-User-Id` returns 401. (API test.)
8. The seeded requests are unchanged after the test file runs (the existing `seededRequestsSnapshot` check). (API test.)
9. Web, in "My requests" with a draft and a submitted request: only the draft has an `Edit <title>` button, next to `Submit <title>`. (Web test.)
10. Clicking Edit shows a form named "Edit request" whose fields hold the draft's values (amount `1250.00` for 125000 cents). (Web test.)
11. Changing the title and clicking "Save changes" sends one `PATCH /api/purchase-requests/<id>` with the six fields, closes the form, re-fetches `mine`, and the list shows the new title. (Web test.)
12. Clicking Cancel closes the form and sends no PATCH; the list is unchanged. (Web test.)
13. In the edit form, invalid input (empty title) shows the field error and sends nothing. A failed PATCH shows the error alert and leaves the list as it was. (Web test.)
14. The edit form's Suggest fields button calls the suggestion route and fills fields as in create. (Web test, or the existing form test run against the edit mode.)
15. `docs/specs/purchase-requests-contract.md` lists `PATCH /purchase-requests/:id` with its errors. (Read the file.)

## Tenant isolation and security

- The lookup runs in `withTenant(user.tenantId, …)` and filters `id` and `requester_id = user.userId`, so RLS hides other tenants and the filter hides other requesters; both give the same 404. The UPDATE repeats `id` and `status = 'draft'`; RLS applies to it too.
- The body can't carry tenant, requester, status or id (strict schema). The supplier is checked by the existing composite foreign key (`23503` becomes 404, via `isKeyViolation`), so another tenant's supplier is refused.
- Tests cover tenant A against tenant B with a crafted id, in both directions.
- `X-User-Id` stays a dev stub, not authentication.

## Out of scope

- Deleting or discarding drafts, edit history, audit trail, conflict checks (last save wins).
- Editing a non-draft, resubmitting a rejected request.
- Any migration or change to RLS, policies or grants.
- Changing the create route, the suggestion route or `createPurchaseRequestSchema`'s behaviour.

## Assumptions

- **Verb and route:** `PATCH /purchase-requests/:id` (full replacement of the six fields, like create). The issue names none; PATCH keeps the existing `POST :id/submit` style untouched.
- **An approver may edit their own draft** (they are its requester); the rule is "only the requester who created it, only while a draft". The issue's "approver" refusal means an approver editing someone else's draft (404).
- **Order of checks:** ownership 404, then status 409, then update; a bad body is 400 before any lookup (as create and decide).
- **Edit form is shown in place of the New request form**, above the list, with the draft's values; New request is hidden while editing, as today while creating.
