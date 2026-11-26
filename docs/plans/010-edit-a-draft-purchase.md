# Plan: Edit a draft purchase request

> Spec: factory/jobs/010-edit-a-draft-purchase/spec.md · Type: feature

## Approach

Add `PATCH /purchase-requests/:id` beside `submit`, copying its shape: UUID check, an ownership-scoped lookup, 404 / 409, a status-conditional UPDATE, a read back. The body is the existing create schema (re-exported under a second name so the contract reads clearly). In the web app the existing form gets an optional `initial` draft and switches its labels, so create and edit are one component. This beats a separate edit form because the issue requires the same form and fields, Suggest fields included.

## Libraries and versions

None new. Everything used is already installed (NestJS 12 ESM-only, Kysely, Zod ^4.6.7 in `packages/shared`, React 19, Vitest). `PATCH` is a standard Nest decorator (`Patch` from `@nestjs/common`).

## Files

- `packages/shared/src/purchase-requests.ts` — export `updatePurchaseRequestSchema` and its types.
- `apps/api/src/purchase-requests/purchase-requests.service.ts` — `update(user, id, input)`.
- `apps/api/src/purchase-requests/purchase-requests.controller.ts` — `@Patch(':id')`.
- `apps/web/src/api.ts` — `PATCH` in `call`'s method type, `updateRequest`.
- `apps/web/src/components/NewRequestForm.tsx` — optional `initial`, `onSave` in place of `onCreate`, labels.
- `apps/web/src/components/RequestList.tsx` — Edit button, `onEdit` prop.
- `apps/web/src/App.tsx` — `editing` state, `save`.
- `docs/specs/purchase-requests-contract.md` — the route row.
- `docs/LEARNING.md` — a short note (see step 4).

### New files

- `apps/api/src/purchase-requests/update.spec.ts` — API tests.

## Steps

### 1. Shared schema and contract doc

- In `packages/shared/src/purchase-requests.ts`, after the create types:

```ts
/** PATCH /purchase-requests/:id: the same body as create, replacing the draft's six fields. */
export const updatePurchaseRequestSchema = createPurchaseRequestSchema;
export type UpdatePurchaseRequestInput = CreatePurchaseRequestInput;
export type UpdatePurchaseRequest = CreatePurchaseRequest;
```

- Add to the contract table in `docs/specs/purchase-requests-contract.md`, after the submit row:
  `| PATCH /purchase-requests/:id | its requester | UpdatePurchaseRequest (same as create) | 200 PurchaseRequest, status draft | 400 invalid body, 401, 404 not the caller's, not found or unknown supplier, 409 not a draft |`
  Keep the table's column alignment (Prettier checks `.md`; run `pnpm exec prettier --write docs/specs/purchase-requests-contract.md` only if lint complains, and it will realign the whole table). Also add one bullet under the list below the table: editing replaces all six fields; `currency` and `description` default as in create.

### 2. API

In `purchase-requests.service.ts` add, after `submit`, reusing `isUuid`, `isKeyViolation`, `readBack`; import `type UpdatePurchaseRequest` from `@levelpath/shared`:

```ts
  /** The caller's own draft gets new values and stays a draft. */
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
        // Conditional on owner and status, so a concurrent submit can't be overwritten.
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

A thrown exception rolls the transaction back, so a refused edit writes nothing. In the controller import `Patch` and `updatePurchaseRequestSchema`/`type UpdatePurchaseRequest`, and add (before `:id/submit` is fine; the verbs differ):

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

Note: the body pipe runs before the service, so a non-owner sending an invalid body gets 400, not 404. That reveals nothing (validation is id-independent); the spec's 404 cases all send a valid body. Check `apps/api/src/validation/zod-validation.pipe.ts` and that CORS/Express accept PATCH (the Vite proxy forwards it).

Write `apps/api/src/purchase-requests/update.spec.ts` modelled on `submit.spec.ts` (same `startApp`, `ownerClient`, `deleteRowsTestsCreated`, `seededRequestsSnapshot`, `SEED`, a `createAs` helper and an `edit(userId, id, body)` helper doing `PATCH`). Cases map to spec criteria 1 to 8:

- own draft: all fields change, status stays `draft`, `id`/`requester`/`createdAt` unchanged, `updatedAt` later (compare in SQL as `submit.spec.ts` does), `GET /mine` shows it; omitted currency/description default;
- 404 with identical body for Amir on Alice's draft, Alice on Amir's draft, Alice on Globex `B.purchaseRequests[0]`, an unknown UUID and `not-a-uuid`; the Globex row and the others unchanged via an owner query of all editable columns plus `updated_at`;
- Globex requester (`B.requester`) editing an Acme draft id: 404, Acme row untouched (the cross-tenant proof, with a crafted id);
- 409 for `A.purchaseRequests[1]` and `[2]` (owner query before and after equal);
- 400 table of invalid bodies (`it.each`), including `status`, `id`, `tenantId`, `requesterId`; the row is unchanged;
- 404 for a Globex supplier and an unknown supplier UUID, row unchanged;
- 401 with no header;
- last test: `seededRequestsSnapshot` equals the one taken in `beforeAll`.

### 3. Web

- `api.ts`: widen `method` to `'GET' | 'POST' | 'PATCH'`; add
  `updateRequest: (id: string, input: CreatePurchaseRequestInput) => call('PATCH', `/purchase-requests/${id}`, purchaseRequestSchema, input),`. Add a test in `api.test.ts` if it has a pattern for other calls (check it first).
- `NewRequestForm.tsx` (read it whole first): rename `onCreate` to `onSave`; add optional prop `initial?: PurchaseRequest`. Initial state from it: `description`, `title`, `category`, `amount: centsToAmountText(initial.amountCents)`, `currency`, `supplierId: initial.supplier.id`; otherwise today's defaults. Form `aria-label` is `initial ? 'Edit request' : 'New request'`; the submit button text is `initial ? 'Save changes' : 'Create request'`. Everything else (validation with the shared schema, Suggest fields, tags) is unchanged. Optionally give the Cancel button an `aria-label` only if needed; its visible text `Cancel` is already its name.
- `RequestList.tsx`: new prop `onEdit: (request: PurchaseRequest) => void`; in the `draft` branch, before Submit:
  `<button type="button" className="secondary" aria-label={`Edit ${r.title}`} onClick={() => onEdit(r)}>Edit</button>`. Wrap the two buttons in a fragment, as they sit in the `<li>`. Update every `RequestList` use.
- `App.tsx`: add `const [editing, setEditing] = useState<PurchaseRequest | null>(null);`. Rename `create` to `save`: it calls `editing ? api.updateRequest(editing.id, input) : api.createRequest(input)`, and on success `setFormOpen(false); setEditing(null); await loadMine();`. Render `<NewRequestForm key={editing?.id ?? 'new'} initial={editing ?? undefined} onSave={save} onCancel={() => { setFormOpen(false); setEditing(null); }} …/>`. `onEdit={(r) => { setError(null); setEditing(r); setFormOpen(true); }}`; the New request button sets `setEditing(null)` before `setFormOpen(true)`. The key makes a second Edit show that draft's values and a fresh New form empty. Errors keep the form open already, because `save` only closes on success.
- Tests in `apps/web/src/App.test.tsx`, a new `describe('edit a draft')` using `mockFetch`, `base`, `renderAs(ALICE)`, `purchaseRequest` and `supplier` as the other blocks do: criteria 9 to 15 (Edit only on drafts; pre-filled values including `12.50`-style amount; save sends one PATCH body in create's key order and re-fetches, with the mocked second `mine` reply showing the new title; Cancel sends nothing; empty title blocks; a 409 shows the alert and keeps the form; Suggest fields posts to `/purchase-requests/suggestion` and no PATCH; New request after an edit is empty). The existing `'lists requests…'` and `'names the Submit button…'` tests must keep passing unchanged.

### 4. Docs

- `docs/LEARNING.md`: two lines on the new concept: one form component for create and edit (`initial` prop, `key` per draft), and the status-and-owner-conditional UPDATE as the guard against a concurrent submit.
- `CLAUDE.md`: the Architecture bullet for `apps/api/src/purchase-requests/` is "the contract's routes", so no edit is needed.

### 5. Validate

Run the validation commands below. Then run the app on chosen ports (`API_PORT=<a> pnpm --filter @levelpath/api dev`, `pnpm --filter @levelpath/web dev --port <w> --strictPort`) after `pnpm db:up && pnpm db:migrate && pnpm db:seed`, and exercise criteria 1, 3 and 4 with `curl` and 9 to 12 in the page. Stop with `factory/bin/port stop <port>`.

## Tests

- API (`update.spec.ts`): success and defaults; 404 for another requester, an approver on a requester's draft, a crafted Globex id from each side, an unknown and a non-UUID id; 409 for submitted and approved; 400 for invalid fields and forbidden extra keys; 404 for a foreign supplier; 401; refused edits leave the row (including `updated_at`) unchanged; the seed is unchanged at the end.
- Web: Edit button on drafts only, pre-filled form, Save changes (PATCH body, close, re-fetch, new values), Cancel (no call), validation block, API error keeps form open, Suggest fields in edit, no leftover values in a later New request.

## Validation commands

```bash
pnpm db:up
pnpm build
pnpm lint
pnpm test
git diff --stat origin/main -- db/
```

## Notes

- No catch block in the plan swallows an error: the one in `update` rethrows or maps a key violation to 404, as `create` does.
- Don't edit existing tests; the only existing test code that changes is none: `RequestList` and `NewRequestForm` are only rendered through `App` in the tests (confirm with Grep before renaming `onCreate`).
- Keep the diff small: no new component, no new route module.
