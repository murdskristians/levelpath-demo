# Plan: Edit a draft purchase request

> Spec: factory/jobs/007-edit-a-draft-purchase/spec.md · Type: feature

## Approach

Add `PUT /purchase-requests/:id` that reuses `createPurchaseRequestSchema` and mirrors `submit` in the service (UUID check, select scoped to `requester_id`, 404 / 409, conditional update on `status = 'draft'`, `readBack`). In the web app, give `NewRequestForm` an optional `draft` prop that pre-fills it and switches its labels, and let `Dashboard` hold the draft being edited. Reusing the create schema avoids a second contract that could drift.

## Libraries and versions

None. No new dependency; existing NestJS 12 (ESM, relative imports end in `.js`), Zod, React 19, Vitest.

## Files

- `packages/shared/src/purchase-requests.ts` — add `export const updatePurchaseRequestSchema = createPurchaseRequestSchema;` plus `UpdatePurchaseRequestInput` / `UpdatePurchaseRequest` types, with a one-line doc comment.
- `packages/shared/src/purchase-requests.spec.ts` — a test that the update schema strips nothing and rejects `status`.
- `apps/api/src/purchase-requests/purchase-requests.controller.ts` — `@Put(':id')` route.
- `apps/api/src/purchase-requests/purchase-requests.service.ts` — `update(user, id, input)`.
- `apps/web/src/api.ts` — allow `'PUT'`; add `updateRequest(id, input)`.
- `apps/web/src/components/NewRequestForm.tsx` — optional `draft`, rename `onCreate` to `onSave`.
- `apps/web/src/components/RequestList.tsx` — `onEdit` prop and Edit button on drafts.
- `apps/web/src/App.tsx` — `editing` state, `save` handler.
- `apps/web/src/App.test.tsx` — web tests.
- `docs/specs/purchase-requests-contract.md` — new route row and error notes.
- `docs/LEARNING.md` — short entry: PUT reusing the create schema, update scoped by requester and status.

### New files

- `apps/api/src/purchase-requests/update.spec.ts` — API tests (pattern of `submit.spec.ts`).

## Steps

### 1. Shared schema

Add the alias and types in `packages/shared/src/purchase-requests.ts`, and the schema test. `pnpm --filter @levelpath/shared build` so the apps see it.

### 2. API

Controller (import `Put` from `@nestjs/common`):

```ts
@Put(':id')
update(
  @CurrentUser() user: AuthUser,
  @Param('id') id: string,
  @Body(new ZodValidationPipe(updatePurchaseRequestSchema)) body: UpdatePurchaseRequest,
): Promise<PurchaseRequest> {
  return this.purchaseRequests.update(user, id, body);
}
```

Default status for PUT is 200. Service, next to `submit`:

```ts
/** The caller's own draft gets new values. Anything else the caller may not see is a 404; not a draft is a 409. */
update(user: AuthUser, id: string, input: UpdatePurchaseRequest): Promise<PurchaseRequest> {
  if (!isUuid(id)) throw new NotFoundException();
  return this.db.withTenant(user.tenantId, async (trx) => {
    const request = await trx
      .selectFrom('purchase_requests')
      .select(['id', 'status'])
      .where('id', '=', id)
      .where('requester_id', '=', user.userId)
      .executeTakeFirst();
    if (!request) throw new NotFoundException();
    if (request.status !== 'draft') throw new ConflictException('only a draft can be edited');
    let updated;
    try {
      updated = await trx
        .updateTable('purchase_requests')
        .set({
          supplier_id: input.supplierId,
          title: input.title,
          amount_cents: input.amountCents,
          currency: input.currency,
          category: input.category,
          description: input.description,
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .returning('id')
        .executeTakeFirst();
    } catch (err) {
      // The composite foreign key to suppliers: unknown, or another company's.
      if (isKeyViolation(err)) throw new NotFoundException();
      throw err;
    }
    if (!updated) throw new ConflictException('only a draft can be edited');
    return readBack(trx, id);
  });
}
```

Never set `tenant_id`, `requester_id` or `status`. Write `update.spec.ts` following `submit.spec.ts` (`startApp`, `ownerClient`, `SEED`, `seededRequestsSnapshot`, `deleteRowsTestsCreated`), covering spec criteria 1 to 8: happy path (compare owner row, `updated_at > created_at`), defaults, identical 404s with unchanged rows, 409 for submitted and approved, the 400 table including extra keys, Globex supplier 404, 401, cross-tenant both ways, seed unchanged. For "row unchanged" compare a full owner-connection `select * from purchase_requests where id = $1` before and after.

### 3. Contract document

In `docs/specs/purchase-requests-contract.md` add to the routes table: `PUT /purchase-requests/:id` | its requester | `CreatePurchaseRequest` | `200 PurchaseRequest`, status stays `draft`, all fields replaced | 400, 401, 404 not the caller's, not found or unknown supplier, 409 not a draft. Match the existing column layout.

### 4. Web

- `api.ts`: `method: 'GET' | 'POST' | 'PUT'`; `updateRequest: (id: string, input: CreatePurchaseRequestInput) => call('PUT', \`/purchase-requests/${id}\`, purchaseRequestSchema, input)`.
- `NewRequestForm.tsx`: add `draft?: PurchaseRequest`; rename `onCreate` to `onSave`. Initial state from the draft: `title`, `description`, `category`, `amount = centsToAmountText(draft.amountCents)`, `currency`, `supplierId = draft.supplier.id`. The form's `aria-label` is `draft ? 'Edit request' : 'New request'`; the submit button text is `draft ? 'Save changes' : 'Create request'`. Everything else (validation, Suggest, Cancel, focus on Title) is unchanged.
- `RequestList.tsx`: new prop `onEdit: (request: PurchaseRequest) => void`; on drafts render, before Submit, `<button type="button" className="secondary" aria-label={\`Edit ${r.title}\`} onClick={() => onEdit(r)}>Edit</button>`.
- `App.tsx`: replace `formOpen` with `form: null | 'new' | PurchaseRequest`. Render `<NewRequestForm key={editing?.id ?? 'new'} draft={editing} onSave={save} ... onCancel={() => setForm(null)} />` when `form !== null`; "New request" shows when `form === null`; `RequestList` gets `onEdit={(r) => setForm(r)}`. `save(input)` calls `api.updateRequest(form.id, input)` for an edit, else `api.createRequest(input)`, with the same `run`, then closes and `loadMine()` exactly as `create` does today. Errors go to the ErrorAlert as for create.
- Tests in `App.test.tsx` (reuse `mockFetch`, `purchaseRequest`, `ID`, `fail` from `test/fixtures.ts`; model on the "new request form" and "suggest fields" describes) for spec criteria 9 to 12. Keep existing tests passing: the new-request label and button names are unchanged.

### 5. Docs

Add the `docs/LEARNING.md` entry.

### 6. Validate

Run the validation commands.

## Tests

- API (`update.spec.ts`): as listed in step 2; includes the crafted-id cross-tenant test in both directions and "refused edit changes nothing" for every refusal.
- Shared: update schema rejects `status`, `tenantId`, `id`.
- Web: Edit button only on drafts, pre-filled values, Save sends PUT then re-fetches and shows new values, Cancel sends nothing, empty-title error sends nothing, Suggest fields in edit form.

## Validation commands

```bash
pnpm db:up
pnpm build
pnpm lint
pnpm test
```

Plus: run the API (`API_PORT=<a> pnpm --filter @levelpath/api dev` after `pnpm db:migrate && pnpm db:seed`) and `curl -X PUT` Alice's seeded draft with a valid body (200, status `draft`), then the same as Amir (404) and on her submitted request (409). Open the web app on your port, pick Alice, click Edit on a draft, change the title, Save, and see it in the list.

## Notes

- Do not add a migration; the app role already has UPDATE on `purchase_requests`.
- Every `catch` above logs or rethrows; the supplier-FK catch maps to a typed 404 as in `create`.
- Run `pnpm lint` as check only; format with `pnpm exec prettier --write` on touched files if it fails.
