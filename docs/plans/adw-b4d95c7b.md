# Plan: Edit a draft purchase request

> Spec: agents/b4d95c7b/spec.md · Type: feature

## Approach

Add `PUT /purchase-requests/:id`, copying `submit`'s shape: look up the row by id and `requester_id` inside `withTenant`, 404 if missing, 409 if not a draft, then one conditional `UPDATE … WHERE status = 'draft'`. The body reuses create's rules through a shared `updatePurchaseRequestSchema`. On the web, `NewRequestForm` gets an optional `initial` request and becomes the edit form, and `Dashboard` holds an `editing` state. This reuses one form, so Suggest fields and validation come for free. A second form component would duplicate it.

No migration. `0003` grants `UPDATE` on the table to the app role and the `tenant_isolation` policy has `USING` and `WITH CHECK` on `tenant_id`. `0005`'s columns sit under the same policy. The `UPDATE` sets no `tenant_id`, so the `WITH CHECK` holds.

## Libraries and versions

None. The change uses what is installed: zod, Kysely, NestJS 12 (ESM, relative imports end in `.js`), React 19, Vitest and Testing Library.

## Files

- `packages/shared/src/purchase-requests.ts` — add `updatePurchaseRequestSchema` and its types.
- `packages/shared/src/purchase-requests.spec.ts` — schema tests.
- `apps/api/src/purchase-requests/purchase-requests.service.ts` — `update`.
- `apps/api/src/purchase-requests/purchase-requests.controller.ts` — `PUT :id`.
- `docs/specs/purchase-requests-contract.md` — route row and shape.
- `apps/web/src/api.ts` — allow `PUT`; add `updateRequest`.
- `apps/web/src/api.test.ts` — one test for `updateRequest`, if the file tests the other calls.
- `apps/web/src/components/NewRequestForm.tsx` — `initial`, `onSave`, edit labels.
- `apps/web/src/components/RequestList.tsx` — Edit button.
- `apps/web/src/App.tsx` — `editing` state and `save`.
- `apps/web/src/App.test.tsx` — rename `onCreate` use if any, add edit tests; adjust any existing assertion that lists a draft's buttons.
- `docs/LEARNING.md` — a short entry.

### New files

- `apps/api/src/purchase-requests/update.spec.ts` — API tests over real HTTP.

## Steps

### 1. Shared schema

In `packages/shared/src/purchase-requests.ts`, after `createPurchaseRequestSchema`:

```ts
/** PUT /purchase-requests/:id: the same fields and rules as create, strict for the same reason. */
export const updatePurchaseRequestSchema = createPurchaseRequestSchema;
export type UpdatePurchaseRequestInput = z.input<typeof updatePurchaseRequestSchema>;
export type UpdatePurchaseRequest = z.output<typeof updatePurchaseRequestSchema>;
```

`index.ts` already re-exports the file (check; if it names exports one by one, add these). Spec test: valid body parses, defaults apply, `status`, `id`, `tenantId`, `requesterId` keys and the invalid values are rejected.

### 2. API service

In `PurchaseRequestsService` add, importing `UpdatePurchaseRequest`:

```ts
  /** The caller's own draft gets new field values. Status, requester and tenant never change. */
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
        // Conditional on the status, so a concurrent submit can't be overwritten.
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

Throwing inside `withTenant` rolls the transaction back, so a refused edit writes nothing. `ForbiddenException` is deliberately never used. Confirm `amount_cents` accepts a `number` in `schema.ts` as `create` does.

### 3. API controller

Import `Put` and `updatePurchaseRequestSchema`, `type UpdatePurchaseRequest`. Add:

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

No `@HttpCode` (PUT defaults to 200). No `ApproverGuard`. Update the controller's header comment only if it becomes wrong.

### 4. API tests: `update.spec.ts`

Copy `submit.spec.ts`'s setup (`startApp`, `ownerClient`, `SEED`, `seededRequestsSnapshot`, `deleteRowsTestsCreated` in `afterAll`) and its `createAs` helper. Add `edit(userId, id, body)` doing `PUT` with JSON. `ownerRow(id)` selects `title, amount_cents, currency, supplier_id, category, description, status, requester_id, tenant_id, updated_at`. Tests, one per spec criteria 2 to 10:

- own draft: 200, new values, status `draft`, same `id` and `createdAt`, `updated_at > created_at` in SQL, `mine` shows the values; defaults when `currency` and `description` are left out.
- 404 cases in one test comparing `res.text` for equality: Amir on Alice's draft, Alice on Amir's draft, Bella on an Acme draft id (the tenant-isolation proof: owner row unchanged), unknown UUID, `not-a-uuid`. Compare the owner row before and after.
- unknown supplier and Globex supplier on Alice's own draft: 404, row unchanged.
- 409: seeded `purchaseRequests[1]` and `[2]`, and a draft submitted then edited. Row unchanged.
- 400 table of invalid bodies (incl. extra keys `status`, `id`, `tenantId`, `requesterId`): `apiErrorSchema` parses, `issues` present, row unchanged.
- Amir edits his own draft: 200.
- 401 without `X-User-Id`.
- the seed snapshot is unchanged.

Run with `pnpm db:up` first.

### 5. Contract doc

In `docs/specs/purchase-requests-contract.md` add a table row after `POST /purchase-requests`:
`PUT /purchase-requests/:id` | its requester | `UpdatePurchaseRequest` | `200 PurchaseRequest`, still `draft`, new values | 400 invalid body, 404 not the caller's, not found or unknown supplier, 409 not a draft. Add `UpdatePurchaseRequest = CreatePurchaseRequest` (same fields and rules) under Shapes, and one bullet: a non-draft is a 409 even for its own requester; nothing but the six fields and `updatedAt` changes. Keep the table's column alignment (Prettier checks it: run `pnpm exec prettier --write docs/specs/purchase-requests-contract.md` if the lint complains).

### 6. Web api

In `api.ts` change the `call` method type to `'GET' | 'POST' | 'PUT'`, import `type UpdatePurchaseRequestInput`, and add:

```ts
    updateRequest: (id: string, input: UpdatePurchaseRequestInput) =>
      call('PUT', `/purchase-requests/${id}`, purchaseRequestSchema, input),
```

### 7. Web form

In `NewRequestForm.tsx`:

- Props: replace `onCreate` with `onSave: (input: CreatePurchaseRequestInput) => Promise<void>`; add `initial?: PurchaseRequest`.
- State initialisers read `initial`: `description: initial?.description ?? ''`, `title`, `category`, `amount: initial ? centsToAmountText(initial.amountCents) : ''`, `currency: initial?.currency ?? 'EUR'`, `supplierId: initial?.supplier.id ?? ''`.
- `aria-label={initial ? 'Edit request' : 'New request'}`; submit button text `initial ? 'Save changes' : 'Create request'`.
- `handleSubmit` calls `onSave`. Validation stays on `createPurchaseRequestSchema` (identical to the update schema); leave a one-line comment saying so.
- Suggest, tags, errors: untouched.

### 8. Web list and dashboard

`RequestList`: new prop `onEdit: (request: PurchaseRequest) => void`. Next to Submit, for drafts:

```tsx
<button
  type="button"
  className="secondary"
  aria-label={`Edit ${r.title}`}
  onClick={() => onEdit(r)}
>
  Edit
</button>
```

Wrap both buttons so layout stays as the Submit button's today (reuse an existing class; check `App.css` for button spacing and add a rule only if needed).

`App.tsx`: add `const [editing, setEditing] = useState<PurchaseRequest | null>(null);`. Render the form when `formOpen || editing`:

```tsx
{
  (formOpen || editing) && (
    <NewRequestForm
      key={editing?.id ?? 'new'}
      initial={editing ?? undefined}
      suppliers={suppliers}
      onSave={editing ? save : create}
      onSuggest={(description) => api.suggest(description)}
      onCancel={() => {
        setFormOpen(false);
        setEditing(null);
      }}
    />
  );
}
```

`save` mirrors `create`: `setError(null)`, `run(() => api.updateRequest(editing.id, input), () => undefined)`, on success `setEditing(null)` and `await loadMine()`. On failure the form stays open and `run` has set the error. `onEdit={(r) => { setFormOpen(false); setEditing(r); }}`. The New request button shows when `!formOpen && !editing`. `RequestList` is passed `onEdit`.

### 9. Web tests

In `App.test.tsx` (use `mockFetch`, `purchaseRequest`, `ID`, `fail`; Alice's list holds one draft): update any existing test that counts or lists buttons so it expects Edit on drafts. Add a `describe('edit a draft')` with spec criteria 11 to 17: the Edit button on a draft and not on a submitted one; the form pre-filled (`getByLabelText('Title')` value, amount `1250.00`, supplier select value, description); Save sends one PUT (assert URL, method, `X-User-Id`, body) and no POST, closes the form and the list re-fetches with the new title and `Draft`; empty title shows the error and sends nothing; Cancel sends nothing; Suggest posts and fills; 409 shows the alert (`fail(409, { statusCode: 409, message: 'only a draft can be edited' })`) and keeps the form. Add an `api.test.ts` case for `updateRequest` only if that file already tests each call.

### 10. Docs

`docs/LEARNING.md`: one short entry, "One form, two modes": editing reuses the create form via an `initial` prop; the update route answers 404 for what the caller may not edit and 409 for a non-draft, so the edit leaks nothing (follow the file's heading style).

### 11. Validate

Run the commands below, then the manual check (spec criterion 18).

## Tests

- Shared: update schema accepts and rejects as listed.
- API, over real HTTP and a real database (no DB mock): own draft, defaults, each 404 (another requester, an approver, another tenant with a crafted id, unknown and non-UUID ids, foreign supplier), 409 for non-drafts, 400 for invalid or extra keys, 401, and that every refused edit leaves the owner-read row unchanged. Bella can't update Acme's draft; the seed snapshot is unchanged.
- Web: Edit button, pre-filled form, save, validation, cancel, suggest, error on 409.

## Validation commands

```bash
pnpm db:up
pnpm build
pnpm lint
pnpm test
```

Manual (mock LLM, chosen ports):

```bash
pnpm db:migrate && pnpm db:seed
API_PORT=5101 pnpm --filter @levelpath/api dev
pnpm --filter @levelpath/web dev --port 5102 --strictPort
curl -s -X PUT -H "X-User-Id: a0000000-0000-4000-8000-000000000101" -H "Content-Type: application/json" \
  -d '{"title":"Edited","amountCents":4200,"supplierId":"a0000000-0000-4000-8000-000000000201","category":"other"}' \
  localhost:5101/purchase-requests/a0000000-0000-4000-8000-000000000301
curl -s -X PUT -H "X-User-Id: a0000000-0000-4000-8000-000000000102" -H "Content-Type: application/json" \
  -d '{"title":"Edited","amountCents":4200,"supplierId":"a0000000-0000-4000-8000-000000000201","category":"other"}' \
  localhost:5101/purchase-requests/a0000000-0000-4000-8000-000000000301
factory/bin/port stop 5101 && factory/bin/port stop 5102
```

The first returns 200 (Alice's seeded draft; it changes the seeded row, so re-seed or use a created draft), the second 404.

## Notes

- Every `catch` here rethrows; none is comment-only.
- `ownerRow` in tests must read as owner (`ownerClient`), so RLS doesn't hide the row.
- Don't add `ApproverGuard` or a role check: the rule is "creator", and 404 hides the rest.
- Never edit migrations or any `protected_paths` file.
