# Plan: Edit a draft purchase request

> Spec: agents/ac060a06/spec.md · Type: feature

## Approach

Add `PUT /purchase-requests/:id`, modelled on `submit`: same UUID check, `withTenant`, ownership select, 404/409 split, a conditional UPDATE and `readBack`. The body reuses the create schema (exported under an update name), so the API and the form validate identically. In the web app the existing `NewRequestForm` takes an optional `draft` and becomes the edit form; no second form. Chosen over `PATCH` because the form always sends every field.

## Libraries and versions

None. No new package; uses NestJS 12, Kysely, Zod (already installed), React 19, Vitest.

## Files

- `packages/shared/src/purchase-requests.ts` — export `updatePurchaseRequestSchema = createPurchaseRequestSchema` and `UpdatePurchaseRequest(Input)` types.
- `apps/api/src/purchase-requests/purchase-requests.controller.ts` — `@Put(':id')` with `@HttpCode(200)` and the body pipe.
- `apps/api/src/purchase-requests/purchase-requests.service.ts` — `update(user, id, input)`.
- `docs/specs/purchase-requests-contract.md` — new routes-table row, shapes section note.
- `apps/web/src/api.ts` — `'PUT'` in the `call` method type; `updateRequest(id, input)`.
- `apps/web/src/components/NewRequestForm.tsx` — optional `draft` prop; rename `onCreate` to `onSave`.
- `apps/web/src/components/RequestList.tsx` — `onEdit` prop and Edit button.
- `apps/web/src/App.tsx` — `editing` state, `save` handler.
- `apps/web/src/App.test.tsx` — new `edit a draft` describe.
- `docs/LEARNING.md` — one short entry (see step 4).

### New files

- `apps/api/src/purchase-requests/update.spec.ts` — API tests.

## Steps

### 1. Shared schema

In `packages/shared/src/purchase-requests.ts`, after the create types:

```ts
/** PUT /purchase-requests/:id: the same fields and rules as creating. Strict, so status, ids and the tenant can't be sent. */
export const updatePurchaseRequestSchema = createPurchaseRequestSchema;
export type UpdatePurchaseRequestInput = z.input<typeof updatePurchaseRequestSchema>;
export type UpdatePurchaseRequest = z.output<typeof updatePurchaseRequestSchema>;
```

Check `packages/shared/src/index.ts` re-exports it (add if it lists names).

### 2. API

Service (mirrors `submit` and `create`; import `UpdatePurchaseRequest`):

```ts
/** The caller's own draft gets new field values; it stays a draft. */
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
        .where('requester_id', '=', user.userId)
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

The failed UPDATE rolls the transaction back, so a refused edit changes nothing. Use `now()` in `updated_at` as `submit` does; if a test compares `updatedAt`, remember `now()` is the transaction start, which is later than the earlier request.

Controller: import `Put`, then

```ts
@Put(':id')
@HttpCode(200)
update(
  @CurrentUser() user: AuthUser,
  @Param('id') id: string,
  @Body(new ZodValidationPipe(updatePurchaseRequestSchema)) body: UpdatePurchaseRequest,
): Promise<PurchaseRequest> {
  return this.purchaseRequests.update(user, id, body);
}
```

Contract doc: add the row `PUT /purchase-requests/:id | its requester | UpdatePurchaseRequest (same fields as create) | 200 PurchaseRequest, still draft, new values, new updatedAt | 400, 404 not the caller's, not found or unknown supplier, 409 not a draft`. Add `UpdatePurchaseRequest = CreatePurchaseRequest` under the shapes. Re-run prettier alignment of the table (`pnpm exec prettier --write` on that file is allowed).

Tests, in `update.spec.ts`, copying the setup of `submit.spec.ts` (`startApp`, `ownerClient`, `deleteRowsTestsCreated`, `seededRequestsSnapshot`, `SEED`). Create drafts through `POST /purchase-requests` as an Acme requester; read the row back through the owner client for "unchanged" checks. Cover spec API criteria 1 to 10, plus an afterAll check that `seededRequestsSnapshot` equals the snapshot taken at the start. For the approver case use the Acme approver id in `SEED`; for another requester use the other seeded Acme requester (check `SEED` in `apps/api/test/helpers.ts`); for the other tenant use a Globex user. For the non-draft case submit via the route; for approved/rejected use the approver's decision route on a draft by another requester.

### 3. Web

`api.ts`: change the `call` method type to `'GET' | 'POST' | 'PUT'`; add

```ts
updateRequest: (id: string, input: UpdatePurchaseRequestInput) =>
  call('PUT', `/purchase-requests/${id}`, purchaseRequestSchema, input),
```

`NewRequestForm.tsx`: add optional `draft?: PurchaseRequest` and rename `onCreate` to `onSave` (update all callers, including tests). Initial state from the draft: `useState(draft?.description ?? '')`, `title`, `category`, `centsToAmountText(draft.amountCents)`, `currency` (default `'EUR'`), `supplierId` (`draft?.supplier.id ?? ''`). `aria-label={draft ? 'Edit request' : 'New request'}`; submit button text `draft ? 'Save changes' : 'Create request'`. Use the update schema for validation only if it differs; it is the same object, so keep `createPurchaseRequestSchema`. Suggest fields needs no change.

`RequestList.tsx`: add `onEdit: (id: string) => void`; next to Submit in the draft branch:

```tsx
<button type="button" aria-label={`Edit ${r.title}`} onClick={() => onEdit(r.id)}>
  Edit
</button>
```

`App.tsx`: `const [editing, setEditing] = useState<PurchaseRequest | null>(null);`. `formOpen || editing` shows the form: pass `draft={editing ?? undefined}`, `key={editing?.id ?? 'new'}`, `onSave={editing ? save : create}`, `onCancel={() => { setFormOpen(false); setEditing(null); }}`. Hide the New request button when either is open. `onEdit` finds the request in `mine`, sets `editing` and `formOpen` false. `save`:

```ts
const save = async (input: Parameters<typeof api.updateRequest>[1]) => {
  if (!editing) return;
  setError(null);
  if (
    await run(
      () => api.updateRequest(editing.id, input),
      () => undefined,
    )
  ) {
    setEditing(null);
    await loadMine();
  }
};
```

`run` already catches, sets the error alert and returns false, so the form stays open on failure.

Tests in `App.test.tsx`, a describe `edit a draft`, using `mockFetch` and `purchaseRequest` fixtures like the existing `my requests` tests: spec web criteria 11 to 15 (assert the PUT call body and path in the recorded calls, and the list after a second `GET /purchase-requests/mine` response; for failure, a 404 on PUT shows the alert and keeps the form).

### 4. Docs

`docs/LEARNING.md`: a short entry "Editing a draft: one form, two modes; ownership and status in the UPDATE's WHERE, 404 vs 409 split as in submit".

### 5. Validate

Run the validation commands.

## Tests

- API (`update.spec.ts`): own draft; default currency; other requester, approver, other tenant crafted id, unknown and non-UUID ids all 404 and the row unchanged (the other-tenant 404 body equals the unknown-id 404 body); submitted, approved, rejected give 409; invalid fields and extra keys give 400; foreign and unknown supplier give 404; no header gives 401; the seeded rows are untouched at the end.
- Web: Edit button on drafts only; pre-filled form; Save sends the PUT and refreshes the list; Cancel sends nothing; Suggest fields works in the edit form; a failed save shows the alert and keeps the form.

## Validation commands

```bash
pnpm db:up
pnpm build
pnpm lint
pnpm test
```

Plus, on chosen ports: as Alice, create a draft, `curl -X PUT -H "X-User-Id: a0000000-0000-4000-8000-000000000101" -H "Content-Type: application/json" -d '{...}' localhost:<a>/purchase-requests/<id>` returns 200 with the new values; the same call as a Globex user returns 404.

## Notes

- Route order is safe: `PUT :id` doesn't collide with the GET/POST routes.
- Any `catch` added must log and rethrow or return a typed fallback; the only new one rethrows or maps to `NotFoundException`.
