# Edit a draft purchase request

> Issue #37: Intent: Edit a draft purchase request before submitting it · Type: feature

## Summary

- A requester can change any field of their own draft with a new `PUT /purchase-requests/:id`.
- The draft stays a draft; only `updated_at` changes besides the fields.
- Anyone else, or any non-draft, is refused with the same answers as submit today (404 / 409).
- In "My requests", each draft gets an Edit button that opens the same form, pre-filled, with Save changes and Cancel.
- No migration; the table, RLS policies and grants already cover an UPDATE by the requester.

## Context

- API: `apps/api/src/purchase-requests/purchase-requests.controller.ts` and `.service.ts`. `submit` is the model: UUID check, `withTenant`, select by `id` and `requester_id`, 404 if absent, 409 if not a draft, a conditional UPDATE, then `readBack`. `create` maps a foreign-key violation (`isKeyViolation`) to 404.
- Shared: `packages/shared/src/purchase-requests.ts` has `createPurchaseRequestSchema` (strict: title, amountCents, currency, supplierId, category, description).
- Contract: `docs/specs/purchase-requests-contract.md` (routes table).
- Web: `apps/web/src/api.ts` (`createApi`, only GET and POST today), `apps/web/src/App.tsx` (Dashboard, `formOpen`, `create`), `components/NewRequestForm.tsx` (empty initial state, `onCreate`, `onCancel`, Suggest fields), `components/RequestList.tsx` (Submit button on drafts).

## Requirements

1. `PUT /purchase-requests/:id` takes a body validated by the shared schema for creating a request and returns `200 PurchaseRequest` with the new values, the same `status: "draft"`, and a newer `updatedAt`.
2. Only the request's requester can edit it, and only while it is a draft. The caller's role is not part of the rule.
3. A request the caller can't see or doesn't own (another requester's, another tenant's, unknown, or a non-UUID id) is `404` with the same body for every reason. An approver editing someone else's request is one of these cases.
4. A request that is not a draft is `409`, as a second submit is today (also when the status changes between the read and the write).
5. An invalid body is `400` with `issues`, as for create. The client can't change `status`, requester, tenant, id, or the timestamps: the body is strict, so those keys are `400`.
6. An unknown supplier, or another tenant's, is `404`, as for create.
7. A refused edit changes nothing in the row.
8. The tenant and the user come only from `@CurrentUser()`; the work runs in `withTenant`.
9. The shared package exports the body schema and types for the update (the same shape as create), and the contract document lists the route and its errors.
10. The web API client has `updateRequest(id, input)` that calls the route and parses the response with `purchaseRequestSchema`.
11. In "My requests", each draft shows an Edit button next to Submit, with accessible name `Edit <title>`. Non-drafts have none.
12. Edit opens the request form (in place of the New request form, same fields and validation, same Suggest fields) pre-filled with the draft's values: title, amount as text (like `12.50`), currency, supplier, category, description. The form's accessible name is `Edit request`, the submit button is `Save changes`, the other is `Cancel`.
13. Save changes calls the update, closes the form and shows the new values in the list; the status stays Draft. Cancel closes the form and calls nothing.
14. Server errors from a save show in the existing error alert, and the form stays open.

## Acceptance criteria

1. As Alice (Acme requester) with her own draft, `PUT /purchase-requests/<id>` with new valid fields returns 200, the body parses with `purchaseRequestSchema`, shows the new values, `status` `draft`, the same `id`, `requester` and `createdAt`, and `updatedAt` later than before. `GET /purchase-requests/mine` shows the same values. (API test)
2. Sending the body without `currency` gives the default `EUR`, as for create. (API test)
3. Another Acme requester `PUT`ing Alice's draft gets 404, and the row is unchanged (compare through the owner client). (API test)
4. An Acme approver `PUT`ing a requester's draft gets 404, and the row is unchanged. (API test)
5. A Globex user `PUT`ing Alice's draft id gets 404 with a body identical to the 404 for an unknown id; the row is unchanged. (API test)
6. A non-UUID id and an unknown UUID both return 404. (API test)
7. Editing a request that is submitted, approved or rejected returns 409, and the row is unchanged. (API test)
8. An empty title, a negative amount, a bad currency, an unknown category, and a body with `status`, `id`, `tenantId` or `requesterId` each return 400, and the row is unchanged. (API test)
9. A supplier id from another tenant, and an unknown supplier id, return 404 and the row is unchanged. (API test)
10. A request with no `X-User-Id` returns 401. (API test)
11. Web: a draft in "My requests" shows a button named `Edit <title>`; a submitted request doesn't. (web test)
12. Web: clicking it shows a form named `Edit request` whose fields hold the draft's values (amount `12.50` for 1250 cents), with `Save changes` and `Cancel` buttons. (web test)
13. Web: changing the title and clicking `Save changes` sends `PUT /api/purchase-requests/<id>` with the shared-schema body, then the list shows the new title with the Draft badge and the form is gone. (web test)
14. Web: `Cancel` closes the form, sends no PUT, and the list is unchanged. (web test)
15. Web: with the edit form open, typing a description and clicking `Suggest fields` fills fields as it does when creating (mock provider). (web test)
16. `pnpm build`, `pnpm lint` and `pnpm test` pass, and the contract document lists `PUT /purchase-requests/:id`.

## Tenant isolation and security

- The update runs in `withTenant`, so RLS limits it to the caller's tenant; the `WHERE` also names `requester_id = caller` and `status = 'draft'`. A crafted id from another tenant matches no row and answers like an unknown id.
- `tenant_id` and `requester_id` are never in the SET list; the body schema is strict.
- The supplier foreign key is composite with the tenant, so another tenant's supplier fails the key and gives 404 (same as create).
- `X-User-Id` is a dev stub, not authentication. No new PII.

## Out of scope

- Deleting or discarding a draft, edit history or audit, conflict checks between two open forms (last save wins), editing non-drafts or resubmitting a rejected one, any database change.
- Changes to `factory/config.json` protected paths.

## Assumptions

- The method is `PUT` with the full create body (every field, `currency` optional). A partial `PATCH` was not asked for and the form always sends all fields.
- Ownership alone decides who may edit, so an approver editing their own draft is allowed; an approver editing someone else's gets 404. The issue's "approvers" refusal is read as that case.
- The edit form replaces the New request form in the same place; the "New request" button is hidden while it is open, as today.
- Wording: `Edit`, `Save changes`, `Cancel`.
- A body with an invalid field is `400` before ownership is looked up, as for create and decision; this reveals nothing about the id.
