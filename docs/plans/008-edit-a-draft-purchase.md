# Plan: Edit a draft purchase request

> Spec: factory/jobs/008-edit-a-draft-purchase/spec.md · Type: feature

## Approach

Add `PUT /purchase-requests/:id` beside `submit`, built the same way: the body through `ZodValidationPipe(createPurchaseRequestSchema)` (the create schema, reused as is), then in the service an `isUuid` check, a select filtered by `requester_id = user.userId` inside `withTenant` (404 if nothing), a 409 if it is not a draft, and a conditional `UPDATE … WHERE id AND requester_id AND status = 'draft'` that sets the six fields and `updated_at = now()`. The supplier FK violation becomes the same 404 as in `create`. The reply goes through `readBack`.

On the web, `NewRequestForm` gets an optional `initial` draft: when given, its state starts from the draft, its name becomes "Edit request" and its button "Save changes". `App`'s `formOpen` boolean becomes "which form is open" (none, new, or the draft being edited), and the same `save` handler calls create or update. `RequestList` gets an Edit button next to Submit.

Why this way: reusing the create schema and the submit pattern means one set of validation rules, one 404 shape and one race-safe update, with no new schema, module or migration. `PUT` (full replacement) matches a body with defaults; a `PATCH` would need a second, partial schema nobody asked for.

## Libraries and versions

None new. The change relies on what is installed:

- `@nestjs/common` `^12.4.2` in `apps/api/package.json` (checked `pnpm view @nestjs/common dist-tags`: `latest` 12.6.3, ESM-only). `Put` is a standard decorator of `@nestjs/common`, answering 200 by default.
- `kysely` `^0.29.9`, `zod` `^4.6.7`, `vitest` `^5.1.0`, `@testing-library/react` `^16.3.3`: already used the same way by `submit`, `create` and the existing tests.

## Files

- `apps/api/src/purchase-requests/purchase-requests.controller.ts` — add the `@Put(':id')` route (import `Put`).
- `apps/api/src/purchase-requests/purchase-requests.service.ts` — add `update(user, id, input)`.
- `docs/specs/purchase-requests-contract.md` — the route row and the full-replacement bullet.
- `apps/web/src/api.ts` — widen `call`'s method to `'GET' | 'POST' | 'PUT'`; add `updateRequest`.
- `apps/web/src/components/NewRequestForm.tsx` — optional `initial` draft; rename `onCreate` to `onSave`; name and button text by mode.
- `apps/web/src/components/RequestList.tsx` — `onEdit` prop and the Edit button.
- `apps/web/src/App.tsx` — the open-form state, `save`, wiring of Edit.
- `apps/web/src/App.css` — add `.request-actions` to the existing `.form-actions` rule (same flex and gap).
- `apps/web/src/App.test.tsx` — a new `describe('edit a draft')` block (existing tests untouched).
- `apps/web/src/api.test.ts` — one test for `updateRequest`.
- `docs/LEARNING.md` — one entry.

### New files

- `apps/api/src/purchase-requests/update.spec.ts` — the route over real HTTP: happy path, full replacement, approver's own draft, every 404, 409, 400, 401, seed unchanged.

## Steps

### 1. Contract document

No change to `packages/shared`: the body is `createPurchaseRequestSchema` and the reply `purchaseRequestSchema`, both exported already.

In `docs/specs/purchase-requests-contract.md`, add a row to the Routes table right after `POST /purchase-requests/:id/submit` (keep the table aligned; Prettier checks Markdown):

| `PUT /purchase-requests/:id` | its requester | `CreatePurchaseRequest` | `200 PurchaseRequest`, still `draft`, every field replaced | 400 invalid body, 404 not the caller's or not found or unknown supplier, 409 not a draft |

And a bullet under the table, after the `:id must be a UUID` bullet:

- **`PUT /purchase-requests/:id`** replaces all six fields of the caller's own draft: a field left out takes its default (`currency` `EUR`, `description` `""`). The status, requester, tenant, id and `createdAt` never change; `updatedAt` does. The body is validated before the id is looked up, so a 400 is the same for every id.

### 2. API: the route, the service method, the tests

Read both files whole first.

**Controller** (`purchase-requests.controller.ts`): import `Put` from `@nestjs/common`, and add after `submit`:

```ts
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createPurchaseRequestSchema)) body: CreatePurchaseRequest,
  ): Promise<PurchaseRequest> {
    return this.purchaseRequests.update(user, id, body);
  }
```

No `ApproverGuard`, no `ParseUUIDPipe` (the service answers a non-UUID with 404, as the comment at the top of the controller says).

**Service** (`purchase-requests.service.ts`), after `submit`:

```ts
  /** The caller's own draft gets new values for all six fields; it stays a draft. */
  update(user: AuthUser, id: string, input: CreatePurchaseRequest): Promise<PurchaseRequest> {
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

Nothing else in the service changes. Never set `tenant_id`, `requester_id`, `status` or `id` from the input.

**Tests** (`apps/api/src/purchase-requests/update.spec.ts`), modelled on `submit.spec.ts` and `create.spec.ts` (same imports, `beforeAll` with `startApp`, `ownerClient`, `seededRequestsSnapshot`; `afterAll` with `deleteRowsTestsCreated`, `owner.end()`, `app.close()`). Helpers in the file:

- `put(userId: string | undefined, id: string, body?: unknown)` → `{ status, text }`, like `create` in `create.spec.ts` (Content-Type only when there is a body), with `method: 'PUT'` and url `${url}/purchase-requests/${id}`.
- `createAs(userId, body = { title: 'Edit test', amountCents: 1000, supplierId: A.suppliers[0], category: 'other' })` → the parsed `PurchaseRequest` (expect 201), as in `submit.spec.ts`.
- `ownerRow(id)`: `select status, title, amount_cents, currency, supplier_id, category, description, updated_at from purchase_requests where id = $1`.
- `const valid = { title: 'Edited', amountCents: 2000, supplierId: A.suppliers[1], category: 'hardware' }` and `NOT_FOUND = { message: 'Not Found', statusCode: 404 }`.

Cases (spec acceptance criteria 2 to 10):

1. Happy path: create as Alice, `put` the body of criterion 2, expect 200 and the full `toEqual` of criterion 2 (`createdAt` equal to the created one's, `updatedAt: expect.any(String)`), then the owner query with `updated_at > created_at as later` (compared in SQL, as `submit.spec.ts` does).
2. Full replacement: create with `currency: 'USD', description: 'Something'`, `put` with `valid` (no currency, no description): `currency` `EUR`, `description` `''` in the reply and the row.
3. Amir edits a draft he created: 200, `status: 'draft'`, `requester.id` Amir.
4. Same 404 for `not-a-uuid`, `UNKNOWN`, `B.purchaseRequests[0]`, and a draft Amir created, all as Alice: status 404, `apiErrorSchema.parse(...)` equals `NOT_FOUND`, `new Set(texts).size === 1`; `ownerRow` of the Globex draft and of Amir's draft equal to before.
5. Alice's fresh draft, `put` as `A.approver`, `B.requester`, `B.approver`: each 404 with `NOT_FOUND`; Alice's `ownerRow` unchanged.
6. Alice's own draft with `supplierId: B.suppliers[0]` and with `UNKNOWN`: each 404 `NOT_FOUND`, same text, row unchanged.
7. 409 for `A.purchaseRequests[1]`, `[2]`, `[3]` with `valid` (rows unchanged: compare `ownerRow` before and after); and a fresh draft submitted with `POST …/submit`, then `put`: 409, `ownerRow` unchanged.
8. 400: `it.each` over the same invalid cases as `create.spec.ts` (copy the list, with `valid` from this file), each on a fresh draft of Alice: 400, `issues` non-empty and containing the path, `ownerRow` unchanged. Plus: one invalid body (`{ ...valid, title: '' }`) on Alice's draft and on `B.purchaseRequests[0]`: both 400 with identical texts.
9. 401 without `X-User-Id` on Alice's draft: body `{ message: 'Unauthorized', statusCode: 401 }`, row unchanged.
10. `seededRequestsSnapshot(owner)` equals the `beforeAll` snapshot.

Never edit the seeded drafts (`A.purchaseRequests[0]`, `B.purchaseRequests[0]`) successfully: their `updated_at` is in the seed snapshot that later spec files compare. Refused attempts on them are fine (cases 4 and 8).

Run: `pnpm db:up`, `pnpm --filter @levelpath/shared build`, `pnpm --filter @levelpath/api test`.

### 3. Web: API client, form, list, app, tests

Read each file whole first.

**`apps/web/src/api.ts`:** `method: 'GET' | 'POST' | 'PUT'`, and after `createRequest`:

```ts
    updateRequest: (id: string, input: CreatePurchaseRequestInput) =>
      call('PUT', `/purchase-requests/${id}`, purchaseRequestSchema, input),
```

**`apps/web/src/components/NewRequestForm.tsx`:**

- Props: add `initial?: PurchaseRequest` (import the type from `@levelpath/shared`), documented as "the draft being edited; absent for a new request", and rename `onCreate` to `onSave` (same type). `handleSubmit` calls `onSave(result.data)`.
- Initial state from it: `description` `initial?.description ?? ''`, `title` `initial?.title ?? ''`, `category` `initial?.category ?? ''`, `amount` `initial ? centsToAmountText(initial.amountCents) : ''`, `currency` `initial?.currency ?? 'EUR'`, `supplierId` `initial?.supplier.id ?? ''`. `suggested` still starts empty.
- `aria-label={initial ? 'Edit request' : 'New request'}` on the form; the submit button text `{initial ? 'Save changes' : 'Create request'}`. Cancel, Suggest fields, validation and focus stay as they are.

**`apps/web/src/components/RequestList.tsx`:** add `onEdit: (request: PurchaseRequest) => void`. Replace the draft's single Submit button with:

```tsx
{
  r.status === 'draft' && (
    <div className="request-actions">
      <button type="button" aria-label={`Submit ${r.title}`} onClick={() => onSubmit(r.id)}>
        Submit
      </button>
      <button
        type="button"
        className="secondary"
        aria-label={`Edit ${r.title}`}
        onClick={() => onEdit(r)}
      >
        Edit
      </button>
    </div>
  );
}
```

**`apps/web/src/App.css`:** change the selector `.form-actions {` to `.form-actions,\n.request-actions {` (no new values).

**`apps/web/src/App.tsx`** (`Dashboard`):

```ts
/** Which form is open: none, a new request, or the draft being edited. */
type OpenForm = null | { mode: 'new' } | { mode: 'edit'; request: PurchaseRequest };
```

- Replace `formOpen` with `const [form, setForm] = useState<OpenForm>(null);`.
- Replace `create` with:

```ts
const save = async (input: CreatePurchaseRequestInput) => {
  if (!form) return;
  setError(null);
  const call =
    form.mode === 'edit'
      ? () => api.updateRequest(form.request.id, input)
      : () => api.createRequest(input);
  if (await run(call, () => undefined)) {
    setForm(null);
    await loadMine();
  }
};
```

(import `type CreatePurchaseRequestInput` from `@levelpath/shared`). A failed call goes through `run`, which sets the error for the existing `ErrorAlert` and leaves the form open.

- Render the form when `form` is set, with `key={form.mode === 'edit' ? form.request.id : 'new'}` (a different draft remounts it: fresh state, no carried-over tags, Title focused), `initial={form.mode === 'edit' ? form.request : undefined}`, `onSave={save}`, `onCancel={() => setForm(null)}`, and `onSuggest` unchanged (with its comment).
- `RequestList` gets `onEdit={(request) => setForm({ mode: 'edit', request })}`.
- The "New request" button shows when `!form` and calls `setForm({ mode: 'new' })`.

**Tests:**

- `apps/web/src/api.test.ts`: `updateRequest` with `mockFetch({ [\`PUT /purchase-requests/${ID(1)}\`]: purchaseRequest() })`(import`ID`from the fixtures): resolves to the parsed request; the call has`method: 'PUT'`, url `/api/purchase-requests/<ID(1)>`, the input as `body`, `X-User-Id` Alice.
- `apps/web/src/App.test.tsx`: a new `describe('edit a draft', …)` after `new request form`, with its own helpers (don't move or change the existing ones). Fixture draft: `const draft = purchaseRequest({ description: 'For the new hires' })`. For the save test, keep the list in a variable so the re-fetch shows the edit: `let current = draft;` with the routes `'GET /purchase-requests/mine': () => [current]` and ``[`PUT /purchase-requests/${ID(1)}`]: () => (current = purchaseRequest({ ...draft, title: 'Gaming laptops' }))``. Tests for spec criteria 14 to 18:
  1. Edit button: draft "Laptops" and a rejected "Chairs" (`ID(2)`): `Edit Laptops` with text `Edit` in the first item, no `Edit Chairs`.
  2. Pre-filled form: click `Edit Laptops`; `getByRole('form', { name: 'Edit request' })` precedes the list (`compareDocumentPosition`, as the existing "puts the form above the list" test); the six values; Title is `document.activeElement`; `Save changes` present, `Create request` and `New request` absent.
  3. Save: change Title, click `Save changes`; exactly one `PUT` with the body of criterion 16 (`toEqual`), header Alice, no `POST /purchase-requests`; the form closes; `count('GET', '/purchase-requests/mine')` reaches 2; the list shows the new title and `Draft`.
  4. Cancel: no `PUT`, the form is gone, "Laptops" still listed, `GET mine` count 1.
  5. Validation: clear Title, `Save changes`: Title `aria-invalid="true"`, the title error message, no `PUT`.
  6. Failed save: `PUT` replies `fail(409, { statusCode: 409, message: 'only a draft can be edited' })`; the alert contains the message; `getByRole('form', { name: 'Edit request' })` still there.
  7. Suggest fields: `GET /suppliers` returns `[supplier(), <a second supplier>]`, `POST /purchase-requests/suggestion` returns a suggestion naming the second supplier; click `Suggest fields` (enabled, the description is pre-filled); one suggestion call with `{ description: 'For the new hires' }`; fields filled and tagged; `Save changes` sends the `PUT` with the suggested values. Define the suggestion constants inside this block.

Run: `pnpm --filter @levelpath/shared build`, `pnpm --filter @levelpath/web test`.

### 4. Docs

`docs/LEARNING.md`, a new entry before the graphify entry (same three-bullet shape as the others):

- Heading: `## An edit as a full replacement, with the create schema (edit a draft)`
- **What:** `PUT /purchase-requests/:id` takes the same body as `POST /purchase-requests`, parsed by the same strict `createPurchaseRequestSchema`, and replaces all six fields. A field left out takes its default, so the form always sends every field. The service copies submit: a select filtered by the caller's id (404 for anything else), 409 for a non-draft, then an `UPDATE … WHERE status = 'draft'`.
- **Why it matters:** One schema means create and edit can't drift apart, and the strict keys mean the client can't change the status, the requester or the tenant. A partial `PATCH` would need a second schema in which every field is optional and nothing has a default, so leaving a field out keeps it.
- **Where:** `update` in [purchase-requests.service.ts](../apps/api/src/purchase-requests/purchase-requests.service.ts), [update.spec.ts](../apps/api/src/purchase-requests/update.spec.ts), [NewRequestForm.tsx](../apps/web/src/components/NewRequestForm.tsx).

`CLAUDE.md` needs no change (no new command or convention; the purchase-requests folder is already described).

### 5. Validate

Run the validation commands below, then exercise the spec's acceptance criteria 11 and 20 on your own ports.

## Tests

- **API (`update.spec.ts`, real database, real HTTP):** happy path with the full reply and the owner-side row; full replacement (defaults); an approver's own draft; one identical 404 for a non-UUID, an unknown id, a Globex draft and another requester's draft; 404 for Alice's draft when called by the Acme approver, the Globex requester and the Globex approver (tenant A's row can't be updated from tenant B's context, even with the exact id); 404 for another tenant's or an unknown supplier; 409 for submitted, approved and rejected requests and for a draft submitted in between; 400 for every invalid body of `create.spec.ts`, and the same 400 text for another tenant's id; 401; every refusal leaves the row unchanged as the owner sees it; the seed snapshot unchanged.
- **Web (`App.test.tsx`, `api.test.ts`, mocked fetch only):** the Edit button only on drafts with its accessible name; the pre-filled "Edit request" form above the list with Title focused; Save sends one `PUT` with all six fields and re-fetches; Cancel sends nothing; validation blocks an invalid save; a 409 shows the alert and keeps the form; Suggest fields works in the edit form; `updateRequest` sends `PUT`.
- RLS's own isolation tests (`apps/api/src/db/rls-isolation.spec.ts`) already cover `UPDATE` on `purchase_requests` across tenants; no change there.

## Validation commands

```bash
pnpm db:up
pnpm build
pnpm lint
pnpm test
bash factory/checks.sh
```

Plus, on your own ports (after `pnpm db:migrate && pnpm db:seed`):

```bash
API_PORT=<a> pnpm --filter @levelpath/api dev
# create a fresh draft as Alice, then edit it (spec criterion 11)
curl -s -X POST -H "X-User-Id: a0000000-0000-4000-8000-000000000101" -H "Content-Type: application/json" \
  -d '{"title":"Pens","amountCents":500,"supplierId":"a0000000-0000-4000-8000-000000000201","category":"office_supplies"}' \
  localhost:<a>/purchase-requests
curl -s -X PUT -H "X-User-Id: a0000000-0000-4000-8000-000000000101" -H "Content-Type: application/json" \
  -d '{"title":"Blue pens","amountCents":750,"supplierId":"a0000000-0000-4000-8000-000000000201","category":"office_supplies"}' \
  localhost:<a>/purchase-requests/<id>
# the same PUT as Bella (Globex) -> 404; a PUT as Alice on a0000000-0000-4000-8000-000000000302 -> 409
API_PORT=<a> pnpm --filter @levelpath/web dev --port <w> --strictPort
# open http://localhost:<w>, pick Alice, and walk through spec criterion 20
factory/bin/port stop <a>; factory/bin/port stop <w>
```

## Notes

- The Vite proxy (`apps/web/vite.config.ts`) only rewrites the path, so `PUT` needs no proxy change.
- `PUT /purchase-requests/suggestion` or `/mine` hits `:id` and gets the 404 for a non-UUID; no route conflict with `POST /purchase-requests/suggestion`.
- The `onCreate` → `onSave` rename touches only `App.tsx`; the existing tests go through `App`, so none of them changes. If any existing test fails, fix the code, not the test.
- Keep the existing create wording ("New request", "Create request") exactly: the existing tests find the form and button by those names.
- The LLM stays the mock: never run `pnpm dev:llm` or anything with `LLM_PROVIDER=anthropic`.
- `pnpm lint` only checks Prettier; format the changed files (`pnpm exec prettier --write <files>`) if it complains, including the Markdown table.
