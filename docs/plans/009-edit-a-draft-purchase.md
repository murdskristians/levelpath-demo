# Plan: Edit a draft purchase request

> Spec: factory/jobs/009-edit-a-draft-purchase/spec.md · Type: feature

## Approach

Add `PATCH /purchase-requests/:id` that mirrors `submit` (own-row lookup, 404/409, conditional UPDATE, `readBack`) and takes the create body. The web reuses `NewRequestForm` in an edit mode (pre-filled, "Save changes") rather than a second form, and `App.tsx` tracks which draft is being edited. No migration: the table's UPDATE grant and RLS already cover it.

## Libraries and versions

None new. Existing: zod `^4.6.7` (ESM, checked in `packages/shared/package.json` and `apps/web/package.json`), NestJS 12 (ESM-only, relative imports end in `.js`), React `^19.3.1`, Vitest.

## Files

- `packages/shared/src/purchase-requests.ts` — export `updatePurchaseRequestSchema = createPurchaseRequestSchema` and the `UpdatePurchaseRequest(Input)` types.
- `packages/shared/src/purchase-requests.spec.ts` — a test that the update schema equals create's behaviour (defaults, strict keys).
- `apps/api/src/purchase-requests/purchase-requests.controller.ts` — `@Patch(':id')`.
- `apps/api/src/purchase-requests/purchase-requests.service.ts` — `update(user, id, input)`.
- `apps/web/src/api.ts` — `'PATCH'` method and `updateRequest(id, input)`.
- `apps/web/src/components/NewRequestForm.tsx` — optional `request` prop (edit mode), `onCreate` renamed `onSave`.
- `apps/web/src/components/RequestList.tsx` — `onEdit` prop and Edit button on drafts.
- `apps/web/src/App.tsx` — `editing` state, `update` handler.
- `apps/web/src/App.test.tsx` — web tests (keep existing ones; adapt only if a renamed prop forces it).
- `docs/specs/purchase-requests-contract.md` — route row, rules, shape.
- `docs/LEARNING.md` — one short entry (own-row UPDATE with a status guard; one form for create and edit).

### New files

- `apps/api/src/purchase-requests/update.spec.ts` — API tests, modelled on `submit.spec.ts`.

## Steps

### 1. Shared schema

In `purchase-requests.ts`, after the create schema:

```ts
/** PATCH /purchase-requests/:id. The same six fields and rules as create, so the same strict schema. */
export const updatePurchaseRequestSchema = createPurchaseRequestSchema;
export type UpdatePurchaseRequestInput = CreatePurchaseRequestInput;
export type UpdatePurchaseRequest = CreatePurchaseRequest;
```

Check `index.ts` re-exports everything (add if it lists names). Add a spec: rejects `status`/`id`/`tenantId` keys, defaults currency and description.

### 2. API

Controller (add `Patch` to the `@nestjs/common` import):

```ts
@Patch(':id')
update(
  @CurrentUser() user: AuthUser,
  @Param('id') id: string,
  @Body(new ZodValidationPipe(updatePurchaseRequestSchema)) body: UpdatePurchaseRequest,
): Promise<PurchaseRequest> {
  return this.purchaseRequests.update(user, id, body);
}
```

Service, next to `submit`:

```ts
/** The caller's own draft gets new field values. Not theirs or not found: 404; not a draft: 409. */
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
    let updated: { id: string } | undefined;
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

Import the type `UpdatePurchaseRequest` (type import from `@levelpath/shared`). Never set `tenant_id`, `requester_id`, `status` or `id`. Match how `create` types `amount_cents` (reuse the same value form as the insert).

Write `update.spec.ts` covering spec criteria 1 to 8, copying the helpers (`startApp`, `ownerClient`, `SEED`, `seededRequestsSnapshot`, `deleteRowsTestsCreated`) from `submit.spec.ts`. Use the owner client to assert rows are unchanged after each refusal (select all six fields plus `status`, `requester_id`, `updated_at`). A Globex requester id is in `SEED.globex`; read the helper for its key name. For the 404 case compare response texts with `Set` size 1.

### 3. Web API client

In `api.ts` widen `method` to `'GET' | 'POST' | 'PATCH'` and add:

```ts
updateRequest: (id: string, input: UpdatePurchaseRequestInput) =>
  call('PATCH', `/purchase-requests/${id}`, purchaseRequestSchema, input),
```

(import the type from `@levelpath/shared`). Add a case to `api.test.ts` if it tests each call.

### 4. Web form, list, app

- `NewRequestForm`: new optional prop `request?: PurchaseRequest`; rename `onCreate` to `onSave`. Initial state from it: `title`, `description`, `category`, `currency`, `supplierId: request.supplier.id`, `amount: centsToAmountText(request.amountCents)`; otherwise today's defaults. `aria-label` is `request ? 'Edit request' : 'New request'`; the submit button text is `request ? 'Save changes' : 'Create request'`. Everything else (validation, Suggest, Cancel) is unchanged. App must render it with `key={editing?.id ?? 'new'}` so the state resets between drafts.
- `RequestList`: new prop `onEdit: (id: string) => void`; in the draft block add before Submit `<button type="button" className="secondary" aria-label={`Edit ${r.title}`} onClick={() => onEdit(r.id)}>Edit</button>`.
- `App.tsx`: `const [editing, setEditing] = useState<PurchaseRequest | null>(null)`. `formOpen || editing` shows the form with `request={editing ?? undefined}`; `onSave` is `editing ? update : create`; `onCancel` clears both. `update(input)` mirrors `create`: `setError(null)`, `run(() => api.updateRequest(editing.id, input), () => undefined)`, on success `setEditing(null)` and `await loadMine()`. Hide New request while either is open. The Edit button opens the form with the list item from `mine`.
- Tests in `App.test.tsx` (use `test/fixtures.ts`) for spec criteria 9 to 14, following the existing create tests' fetch mock. Cover: a failed PATCH shows the alert and keeps the list.

### 5. Docs

Contract: add the table row `PATCH /purchase-requests/:id | its requester | UpdatePurchaseRequest (= CreatePurchaseRequest) | 200 PurchaseRequest, still draft | 400, 401, 404 (not the caller's, not found, unknown supplier), 409 not a draft`; add `UpdatePurchaseRequest` to Shapes. Keep the table's column alignment (Prettier checks `.md`). Add the LEARNING.md entry.

### 6. Validate

Run the validation commands below.

## Tests

- API (`update.spec.ts`): own draft edit (all six fields, `updatedAt` later, status, requester and `createdAt` kept); defaults; approver on another's draft, requester on an approver's draft, Globex requester on an Acme id, Alice on a Globex id, non-UUID, unknown UUID (identical 404, rows unchanged); submitted, approved and already-submitted drafts (409, unchanged including `updated_at`); invalid bodies (400, unchanged); other-tenant supplier (404, unchanged); no header (401); seed unchanged.
- Shared: update schema strictness and defaults.
- Web: Edit button only on drafts, pre-filled form, save, cancel, validation error, failed save, Suggest in edit mode.

## Validation commands

```bash
pnpm db:up
pnpm build
pnpm lint
pnpm test
```

Then on chosen ports: `API_PORT=<a> pnpm --filter @levelpath/api dev`, and
`curl -X PATCH -H "X-User-Id: a0000000-0000-4000-8000-000000000101" -H "Content-Type: application/json" -d '{"title":"Edited","amountCents":500,"supplierId":"<an Acme supplier id>","category":"other"}' localhost:<a>/purchase-requests/<Alice's draft id>` returns 200 with `"status":"draft"`. In the web app as Alice, click Edit on a draft, change the title, Save.

## Notes

- Existing tests are not to be weakened; only the `onCreate` to `onSave` rename may touch them.
- Every `catch` logs and rethrows or returns a typed error; the service's catch rethrows (404 is a typed error). Nothing swallows.
- Prettier checks the markdown table in the contract: run `pnpm lint` and keep the columns aligned (use `pnpm exec prettier --write docs/specs/purchase-requests-contract.md` only if lint complains).
