# API: purchase requests from draft to decision

> Issue #5: API: purchase requests from draft to decision · Type: feature · Intent: docs/intent/purchase-requests.md · Contract: docs/specs/purchase-requests-contract.md · Risk: high · Surfaces: api, db, security

<!-- WHAT and HOW TO CHECK IT. Written by the planner. The builder tests against the acceptance criteria, the verifier exercises them, reviewer-spec traces them to the diff, the approver checks them. -->

## Summary

- `apps/api` gets the six routes of the agreed contract: `GET /suppliers`, `GET /purchase-requests/mine`, `GET /purchase-requests/to-decide`, `POST /purchase-requests`, `POST /purchase-requests/:id/submit` and `POST /purchase-requests/:id/decision`.
- Every request body is validated with the shared Zod schemas through one validation pipe. A 400 lists the issues. Every response parses with `supplierSchema`, `purchaseRequestSchema` or `apiErrorSchema`.
- All data goes through `withTenant(caller.tenantId, …)`. Another company's id, another requester's draft and a non-UUID id all give the same 404. A 403 is returned only for a requester on an approver-only route (checked before anything else) and for an approver deciding their own request.
- Submit and decide change the status with an `UPDATE … WHERE status = …`, so two concurrent decisions can't both succeed. No migration is needed.
- Tests run over real HTTP against the run's real database, for every route and every status code the contract lists.

## Context

- **The contract:** `docs/specs/purchase-requests-contract.md` (the route table, the 404 and 403 rules, the error shape). The shapes are in `packages/shared/src/purchase-requests.ts`: `supplierSchema`, `personSchema`, `createPurchaseRequestSchema` (strict, `currency` defaults to `EUR`), `decisionSchema` (strict, `comment` defaults to `''`, and a rejection without a comment fails on path `comment`), `purchaseRequestSchema` (strict) and `apiErrorSchema`. `MAX_AMOUNT_CENTS` is 10 000 000 000.
- **Tables (already there, with RLS enabled and forced):** `db/migrations/0002_suppliers.sql`, `0003_purchase_requests.sql`, `0004_approvals.sql`. The app role has full DML on all three. `purchase_requests` has composite foreign keys `(tenant_id, supplier_id)` and `(tenant_id, requester_id)`, so another company's supplier fails with `23503`. `approvals` has no unique key on `purchase_request_id`, and nothing updates `updated_at` automatically.
- **The API today:** only `GET /me` reads tenant data (`apps/api/src/me/*`: a thin controller and a service that runs everything in `withTenant`). `DatabaseService.withTenant` (`apps/api/src/db/database.service.ts:75`) is the only way into tenant data. The global `AuthGuard` (`apps/api/src/auth/auth.guard.ts`) answers 401 and puts the caller on the request, and `@CurrentUser()` reads it as `{ userId, tenantId, role }`. `isUuid` is in `apps/api/src/db/uuid.ts`. `main.ts` has no global pipe or filter, and `apps/api` doesn't depend on `zod` directly.
- **Kysely types:** `apps/api/src/db/schema.ts`. `amount_cents` comes back from `pg` as a string, and timestamps come back as `Date`.
- **Seed (`db/seed.sql`, ids in `apps/api/test/helpers.ts` `SEED`):** Acme: Alice (requester, `a0000000-0000-4000-8000-000000000101`), Amir (approver, `…0102`), suppliers `…0201` "Bright Office Supplies" and `…0202` "Nordic Laptops", and requests `…0301` draft, `…0302` submitted, `…0303` approved, `…0304` rejected, all by Alice. Globex has the same layout under `b0000000-…` (Bella, Boris, "Harbor Print Co", "Summit IT Hardware"). Every seeded row has the same `created_at` (one transaction).
- **Tests:** one database per run, shared by every spec file, run one file after another (`apps/api/vitest.config.ts`). `apps/api/src/db/migrations.spec.ts:273-309` checks the exact seed counts (8 requests, 4 approvals, one per status per tenant). Rows a test creates must be gone when its file ends, and seeded rows must never change.

## Requirements

**Routes and shapes**

1. `GET /suppliers` returns `200` with the caller's company suppliers as `Supplier[]` (`{ id, name }`), ordered by name.
2. `GET /purchase-requests/mine` returns `200` with every request the caller created, in any status, as `PurchaseRequest[]`, newest first (`created_at` descending, then `id` descending to break ties).
3. `GET /purchase-requests/to-decide` returns `200` with every `submitted` request of the caller's company as `PurchaseRequest[]`, oldest first (`created_at` ascending, then `id` ascending). This includes the approver's own submitted requests. Only approvers may call it.
4. `POST /purchase-requests` validates the body with `createPurchaseRequestSchema` and inserts a request with `tenant_id` and `requester_id` from `@CurrentUser()`, status `draft`, and the parsed `currency` (default `EUR`). Postgres generates `id`, `created_at` and `updated_at`. It returns `201` with the new `PurchaseRequest` (`decision: null`).
5. `POST /purchase-requests/:id/submit` moves the caller's own `draft` to `submitted`, sets `updated_at` to now, and returns `200` with the `PurchaseRequest`. It takes no body.
6. `POST /purchase-requests/:id/decision` (approvers only) validates the body with `decisionSchema`. It moves a `submitted` request to `approved` or `rejected`, sets `updated_at`, and inserts one `approvals` row (`approver_id` = the caller, `decision`, `comment`). It returns `200` with the `PurchaseRequest` and its `decision`. An approval with an empty comment stores and returns `comment: null`. A rejection stores the trimmed comment.
7. Every `PurchaseRequest` in a response has exactly the keys of `purchaseRequestSchema`: `amountCents` is a JSON integer (the `bigint` converted with `Number`), `createdAt`, `updatedAt` and `decidedAt` are ISO strings (`Date.toISOString()`), `supplier` and `requester` are `{ id, name }`, and `decision` is `null` or `{ decision, comment, approver: { id, name }, decidedAt }` from the request's latest approval. A request never appears twice in a list.
8. The POST routes that change state return `200`, except create, which returns `201`.

**Errors**

9. Every error body parses with `apiErrorSchema` (`{ statusCode, message }`). A body that fails its schema gets `400` with `{ statusCode: 400, message, issues: [{ path, message }] }`, one entry per Zod issue. `path` is the issue path joined with `.`, or `''` for the body itself. This covers an unknown key such as `id`, `tenantId`, `requesterId` or `status`, which the strict schemas reject. A missing body counts as invalid.
10. **404 for anything the caller may not see, with the same body (`{"message":"Not Found","statusCode":404}`) whatever the reason:** an `:id` that isn't a UUID, an id that doesn't exist, another company's id, another requester's request on submit, and another requester's draft on decision. On create, an unknown or other-company `supplierId` is a 404. A foreign-key (`23503`) or unique (`23505`) violation is answered as 404 and never as 500.
11. **403 only in two cases:**
    - a requester calling `GET /purchase-requests/to-decide` or `POST /purchase-requests/:id/decision`. The role is checked before the body, the id or any query, so the answer is the same for every input;
    - an approver deciding a request they created themselves.
12. **409 for the wrong status:** submit on a request of the caller's that isn't a `draft`, and a decision on a visible request that isn't `submitted`. That includes a decision that loses a race with a concurrent one.
13. The checks run in this order. Submit: 401, then 404, then 409. Decision: 401, then 403 for the role, then 400 for the body, then 404, then 403 for your own request, then 409.
14. Every route answers 401 without a valid `X-User-Id` (the existing global `AuthGuard`; no route is `@Public()`).

**Tenancy and data**

15. All reads and writes run inside `DatabaseService.withTenant(user.tenantId, …)`, with the tenant and the caller taken only from `@CurrentUser()`. No body, query or path value ever chooses a tenant, requester, approver, status or id.
16. Submit and decision change the status with one conditional `UPDATE … WHERE id = … AND status = '<expected>'`. If it updates no row, the answer is 409 and nothing is written. Two concurrent decisions on the same request give exactly one `200` and one `409`, and leave exactly one `approvals` row.
17. No migration is added and no existing migration is edited.

**Tests and docs**

18. New Vitest spec files cover every route over real HTTP against the run's database (`startApp()`, `fetch`, `X-User-Id`). They include the happy path, 400 (including a body with `id` and one with `tenantId`), 401, both 403 cases, 404 for another company's id and for another requester's id, 409 and self-approval. Every response body they check is parsed with the shared schema. They delete every row they create and change no seeded row.
19. `docs/LEARNING.md` gets the new concepts, the `nestjs-endpoint` skill stops saying that Zod and the pipe are "not wired yet", and `CLAUDE.md` names the new folders.

## Acceptance criteria

Run the API on your port with a migrated and seeded dev database: `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @levelpath/shared build && API_PORT=<a> pnpm --filter @levelpath/api dev`. Then `API=http://localhost:<a>`, and the ids are `ALICE=a0000000-0000-4000-8000-000000000101`, `AMIR=a0000000-0000-4000-8000-000000000102`, `BELLA=b0000000-0000-4000-8000-000000000101`. The curl checks change only rows they create. They assume the seeded requests still have their seeded statuses; if not, run `pnpm db:seed` on a fresh database. Each criterion is also covered by a test in `apps/api/src/purchase-requests/*.spec.ts` or `apps/api/src/suppliers/*.spec.ts`.

1. **Suppliers, own company, by name.** `curl -s -H "X-User-Id: $ALICE" $API/suppliers` returns `200` with exactly `[{"id":"a0000000-0000-4000-8000-000000000201","name":"Bright Office Supplies"},{"id":"a0000000-0000-4000-8000-000000000202","name":"Nordic Laptops"}]`. With `X-User-Id: $BELLA`, it returns exactly Globex's two, `Harbor Print Co` then `Summit IT Hardware`.
2. **401 on every route.** Each of the six routes, called without `X-User-Id`, returns `401` with `{"message":"Unauthorized","statusCode":401}`. Test: one case per route.
3. **Create, happy path.** `curl -s -i -X POST -H "X-User-Id: $ALICE" -H "Content-Type: application/json" -d '{"title":"  Test chairs  ","amountCents":10000000000,"supplierId":"a0000000-0000-4000-8000-000000000201"}' $API/purchase-requests` returns `201`. The body parses with `purchaseRequestSchema`: `title` is `"Test chairs"`, `amountCents` is the number `10000000000` (not a string), `currency` is `"EUR"`, `status` is `"draft"`, `requester` is `{"id":ALICE,"name":"Alice"}`, `supplier` is `{"id":"…0201","name":"Bright Office Supplies"}`, `decision` is `null`, and `id` is a UUID that Postgres generated. Test: the owner client also sees the row with `tenant_id` = Acme and `requester_id` = Alice.
4. **Create, invalid body: 400 with issues.** Each of these returns `400` with `statusCode: 400`, a `message`, and a non-empty `issues` array of `{ path, message }`, and inserts no row (test: the owner's count of `purchase_requests` is unchanged):
   - `{"title":"x","amountCents":100,"supplierId":"<A supplier>","id":"a0000000-0000-4000-8000-000000000999"}` (an `id`);
   - the same with `"tenantId":"b0000000-0000-4000-8000-000000000001"`;
   - the same with `"status":"approved"`;
   - `{"title":"","amountCents":100,"supplierId":"<A supplier>"}` (has an issue with `path` `"title"`);
   - `{"title":"x","amountCents":10000000001,"supplierId":"<A supplier>"}` (an issue with `path` `"amountCents"`);
   - `{"title":"x","amountCents":1.5,"supplierId":"<A supplier>"}`;
   - `{"title":"x","amountCents":100,"supplierId":"not-a-uuid"}`;
   - no body at all.
5. **Create with another company's or an unknown supplier: 404.** Alice posting a valid body with `supplierId` `b0000000-0000-4000-8000-000000000201` (Globex's) returns `404` `{"message":"Not Found","statusCode":404}`. So does `c0000000-0000-4000-8000-000000000999`. Neither inserts a row, and neither is a 500.
6. **Mine: own requests only, newest first.** After Alice creates two requests (P1, then P2), `GET /purchase-requests/mine` as Alice returns `200`, and every element parses with `purchaseRequestSchema`. P2 is first and P1 second. The list holds Alice's four seeded requests and no Globex id. `createdAt` never increases down the list. The seeded approved request `a…0303` has `decision` `{"decision":"approved","comment":"Within the facilities budget.","approver":{"id":AMIR,"name":"Amir"},"decidedAt":<ISO>}`. As Amir, it holds only requests Amir created (`[]` on a fresh seed; the test checks it before creating any). As Bella, it holds only `b…` ids.
7. **To-decide: submitted, own company, oldest first; 403 for a requester.** As Amir, `GET /purchase-requests/to-decide` returns `200`, every element has `status` `"submitted"` and parses with the schema, it contains `a0000000-0000-4000-8000-000000000302`, it contains no `b…` id, and `createdAt` never decreases down the list. As Alice it returns `403` `{"message":"Forbidden","statusCode":403}`.
8. **Submit, happy path.** Alice creates a draft, then `curl -s -X POST -H "X-User-Id: $ALICE" $API/purchase-requests/<id>/submit` returns `200`, `status` `"submitted"`, with a body that parses. Test: the owner client's `updated_at` for that row is later than its `created_at`.
9. **Submit: 404, the same body for every reason.** Alice submitting each of these returns `404` with an identical body, and changes nothing (test: the owner's row is the same before and after):
   - `not-a-uuid`;
   - `c0000000-0000-4000-8000-000000000999` (doesn't exist);
   - `b0000000-0000-4000-8000-000000000301` (Globex's draft);
   - a draft Amir created (another requester's, same company).

   Amir submitting Alice's seeded draft `a0000000-0000-4000-8000-000000000301` also returns `404`.

10. **Submit, not a draft: 409.** Alice submitting `a0000000-0000-4000-8000-000000000302` (submitted) or `…0303` (approved) returns `409`, and the body parses with `apiErrorSchema`. Submitting her own new draft twice gives `200`, then `409`.
11. **Decision, approve and reject.** Alice creates and submits P. Amir posting `{"decision":"approved"}` to `/purchase-requests/P/decision` returns `200` with `status` `"approved"` and `decision` `{"decision":"approved","comment":null,"approver":{"id":AMIR,"name":"Amir"},"decidedAt":<ISO>}`. For another submitted Q, `{"decision":"rejected","comment":"  Over budget  "}` returns `200` with `status` `"rejected"` and `comment` `"Over budget"`. Test: the owner client sees exactly one `approvals` row for each, with `tenant_id` Acme and `approver_id` Amir.
12. **Decision, invalid body: 400.** As Amir, on a submitted request: `{"decision":"rejected"}` and `{"decision":"rejected","comment":"   "}` return `400` with an issue whose `path` is `"comment"`. `{"decision":"approved","id":"<uuid>"}`, `{"decision":"approved","tenantId":"b0000000-0000-4000-8000-000000000001"}`, `{"decision":"maybe"}` and no body all return `400` with `issues`. The request stays `submitted`, with no `approvals` row.
13. **Decision by a requester: 403 before anything else.** Alice posting `{"decision":"approved"}` to `…0302`, to `not-a-uuid`, to `b0000000-0000-4000-8000-000000000302`, and posting `{"decision":"maybe"}` to `…0302`, all return `403` `{"message":"Forbidden","statusCode":403}`.
14. **Decision: 404 for what the approver may not see.** Amir posting `{"decision":"approved"}` to each of these returns `404` with the same body as for a non-existent id, and changes nothing:
    - `not-a-uuid`;
    - `c0000000-0000-4000-8000-000000000999`;
    - `b0000000-0000-4000-8000-000000000302` (Globex's submitted request; test: it stays `submitted` and gets no `approvals` row);
    - `a0000000-0000-4000-8000-000000000301` (Alice's draft).
15. **Decision: no self-approval (403).** Amir creates and submits his own request R, then posts `{"decision":"approved"}` to R: `403` `{"message":"Forbidden","statusCode":403}`. R stays `submitted` with no `approvals` row. R does appear in Amir's `to-decide`.
16. **Decision: not submitted (409).** Amir posting `{"decision":"approved"}` to `a0000000-0000-4000-8000-000000000303` (approved) or `…0304` (rejected) returns `409`. Deciding a request a second time, after a first decision of `200`, returns `409`.
17. **Concurrent decisions: exactly one wins.** Test: on one new submitted request, two decision calls sent at the same time (`Promise.all`, as Amir) return one `200` and one `409`. The owner client sees exactly one `approvals` row for that request.
18. **Tests clean up.** After `pnpm --filter @levelpath/api test`, every file passes. That includes `migrations.spec.ts`'s seed counts, which pass whichever order the files run in, because the new spec files delete the rows they created (approvals first) and never change a seeded row.
19. **No migration.** `git diff --stat origin/main -- db/` is empty.
20. **Docs.** `docs/LEARNING.md` has a Phase 3 entry on "guards run before pipes" (the role check before validation) and one on a conditional `UPDATE` for status changes. `.claude/skills/nestjs-endpoint/SKILL.md` names the real pipe and guard files. `CLAUDE.md` Architecture lists `apps/api/src/suppliers/` and `apps/api/src/purchase-requests/`.

## Tenant isolation and security

- **The tenant transaction:** every query of the six routes runs in `withTenant(user.tenantId, trx => …)`, and RLS on `suppliers`, `purchase_requests`, `approvals` and `users` hides other companies' rows. The tenant, the requester (on create) and the approver (on decision) come only from `@CurrentUser()`. The strict schemas reject `id`, `tenantId`, `requesterId` and `status` in a body (criteria 4 and 12). `:id` is checked with `isUuid` before it reaches SQL.
- **Cross-tenant ids:** another company's request id behaves exactly like a missing one (criteria 9 and 14, with identical bodies), and its row is unchanged. Another company's supplier fails the composite foreign key, which is answered as 404 (criterion 5). The foreign-key error never reaches the client, so the response doesn't reveal whether the key exists.
- **Within a company:** another requester's request is a 404 on submit. A draft is private to its requester, so it is a 404 on decision. Once submitted, a request is visible to the company's approvers, so a decided one answers 409 on decision.
- **Roles:** the approver-only check uses the role the `AuthGuard` resolved from the database. It runs as a guard before the body pipe and before any query, so a requester learns nothing from the answer (criterion 13). Self-approval is refused inside the tenant transaction, by comparing `requester_id` with the caller (criterion 15).
- **Races:** status changes are conditional updates (requirement 16), so a request can't be decided twice.
- **SQL:** Kysely's query builder only, with no `sql.raw`, `sql.ref`, `sql.table` or `sql.lit` on input. The only new `catch` turns `23503`/`23505` into `NotFoundException` and rethrows everything else.
- **No PII in logs:** no new logging of names, titles or comments.
- `X-User-Id` is still the dev stub, not authentication.

## Out of scope

- Any change to `apps/web` or `packages/shared` (the contract and schemas are fixed; the web job builds against them in parallel).
- Editing, deleting or withdrawing requests, `GET /purchase-requests/:id`, pagination, filtering or sorting parameters.
- A migration (for example a unique key on `approvals.purchase_request_id` or an `updated_at` trigger). The conditional update is enough.
- A global exception filter or a global validation pipe. Existing routes' error bodies stay as they are.
- Validating response bodies at runtime. The TypeScript types from `packages/shared` and the tests cover them.
- Real authentication, CORS, or a `/api` prefix (the web app's Vite proxy maps `/api`).

## Assumptions

- **Check order (requirement 13):** the approver-only check is a route guard, so it runs before the body pipe. A requester gets 403 for every input, which "the role is checked before any lookup, so the answer is the same for every id" asks for. Then 404 comes before the self-check, and the self-check before 409. Reason: each check reveals only what the caller may already see.
- **What an approver "sees" on decision:** any request of their company except another requester's draft. So another requester's approved or rejected request is a 409 and their draft a 404. Reason: the contract says 404 for "another requester's draft" and 409 for "not submitted"; if every non-submitted request were a 404, the 409 would be unreachable.
- **An approver's own submitted request appears in `to-decide`.** Reason: the contract says "submitted, of the caller's company", and the intent says "every submitted request of their company". Deciding it gives the 403 the contract defines.
- **An approval without a comment is stored and returned as `comment: null`**, not `''`. Reason: the column is nullable and the response type allows `null`. "No comment" is clearer as `null`.
- **Unknown or other-company supplier is detected by the composite foreign key (`23503` → 404)**, not by a select first. Reason: it is one mechanism, and the intent already requires that mapping.
- **Malformed JSON** is rejected by the body parser with a 400 before the route runs. Its body is Nest's default, without `issues`. Reason: it is not a schema failure, and changing it needs a global filter, which would also touch the existing routes.
- **`zod` becomes a direct dependency of `apps/api`** (the same `^4.6.7` as `packages/shared`, so the same single copy), only for the pipe's types. Reason: the `nestjs-endpoint` skill says the first route with a body adds Zod and the pipe, and pnpm doesn't let `apps/api` import a package it doesn't declare.
- **Submit by an approver of their own draft is allowed.** Reason: the contract says "its requester", and anyone may create.
