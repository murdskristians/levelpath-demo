# Purchase requests: the API contract

> Intent: docs/intent/purchase-requests.md · Shared by the two Phase 3 issues (API, UI)

<!-- The agreement both factory jobs build against. It lands on main first, as Zod schemas in packages/shared, so the API job implements these shapes and the UI job calls them, in parallel. -->

## Routes

Every route needs `X-User-Id` (the global `AuthGuard`). The tenant and the caller come from `@CurrentUser()`, never from the body, query or path.

| Route                                  | Who           | Body                    | Success                                                                         | Errors                                                                                      |
| -------------------------------------- | ------------- | ----------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /suppliers`                       | anyone        | -                       | `200 Supplier[]`, the caller's company, by name                                 | 401                                                                                         |
| `GET /purchase-requests/mine`          | anyone        | -                       | `200 PurchaseRequest[]` the caller created, newest first                        | 401                                                                                         |
| `GET /purchase-requests/to-decide`     | approver      | -                       | `200 PurchaseRequest[]`: submitted, of the caller's company, oldest first       | 401, 403 for a requester                                                                    |
| `POST /purchase-requests`              | anyone        | `CreatePurchaseRequest` | `201 PurchaseRequest`, status `draft`, requester is the caller                  | 400 invalid body, 404 unknown supplier                                                      |
| `POST /purchase-requests/:id/submit`   | its requester | -                       | `200 PurchaseRequest`, status `submitted`                                       | 404 not the caller's or not found, 409 not a draft                                          |
| `PATCH /purchase-requests/:id`         | its requester | `UpdatePurchaseRequest` | `200 PurchaseRequest`, status `draft`                                           | 400 invalid body, 401, 404 not the caller's, not found or unknown supplier, 409 not a draft |
| `POST /purchase-requests/:id/decision` | approver      | `Decision`              | `200 PurchaseRequest`, status `approved` or `rejected`, with `decision`         | 400, 403 a requester or the request's own requester, 404, 409 not submitted                 |
| `POST /purchase-requests/suggestion`   | anyone        | `SuggestionRequest`     | `200 SuggestionResponse`; `suggestion: null` on any LLM problem; writes nothing | 400 invalid body, 401                                                                       |

- **404, never 403, for something the caller may not see:** another tenant's id, or another requester's draft, behaves like an id that doesn't exist.
- **403 is only for what reveals nothing:**
  - a requester calling an approver-only route: the role is checked before any lookup, so the answer is the same for every id;
  - an approver deciding their own request, which they can see anyway.
- `:id` must be a UUID: anything else is a 404.
- **`PATCH /purchase-requests/:id`** replaces all six create fields of the caller's own draft (`currency` and `description` default as in create) and keeps it a draft; a refused edit changes nothing.
- **`POST /purchase-requests/suggestion`** (Phase 4, [spec](purchase-request-suggestion.md)) never answers 5xx for an LLM problem: an invalid answer after one repair, the 15 s deadline, a refusal, `max_tokens` or a provider error all give `200 {"suggestion": null}`. The suppliers the model may pick from are the caller's own, read through `withTenant`; a `supplierId` outside them becomes `null`.
- **Errors** have the shape `{ "statusCode": n, "message": "…" }`. A 400 adds `"issues": [{ "path": "…", "message": "…" }]` from Zod.

## Shapes (`packages/shared`, Zod)

```ts
USER_ROLES = ['requester', 'approver']
PURCHASE_REQUEST_STATUSES = ['draft', 'submitted', 'approved', 'rejected']
APPROVAL_DECISIONS = ['approved', 'rejected']
PURCHASE_REQUEST_CATEGORIES = ['hardware', 'software', 'office_supplies', 'services', 'travel', 'other']

Supplier = { id: uuid, name: string }
Person = { id: uuid, name: string }

CreatePurchaseRequest = {          // strict: unknown keys (an id, a tenantId) are rejected
  title: string (trimmed, 1..200),
  amountCents: integer, 0..100_000_000_00,
  currency: /^[A-Z]{3}$/ (default "EUR"),
  supplierId: uuid,
  category: one of PURCHASE_REQUEST_CATEGORIES,     // Phase 4, required
  description: string (trimmed, 0..2000, default ""), // Phase 4
}

Decision = {                       // strict
  decision: 'approved' | 'rejected',
  comment: string (trimmed, 0..1000), required when rejected
}

PurchaseRequest = {
  id: uuid, title, amountCents: integer, currency, status, category, description,
  supplier: Supplier, requester: Person,
  createdAt: ISO string, updatedAt: ISO string,
  decision: null | { decision, comment: string | null, approver: Person, decidedAt: ISO string },
}

// Phase 4: Suggest fields
SuggestionRequest = {              // strict: no suppliers, no tenantId
  description: string (trimmed, 1..2000),
}

Suggestion = {                     // strict; also the JSON Schema sent to the model
  title: string (trimmed, 1..200),
  category: one of PURCHASE_REQUEST_CATEGORIES,
  quantity: integer 1..1_000_000 | null,
  amountCents: integer 0..100_000_000_00 | null,   // the total, not per item
  currency: /^[A-Z]{3}$/ | null,
  supplierId: uuid | null,                          // one of the caller's suppliers, or null
}

SuggestionResponse = { suggestion: Suggestion | null }
```

- `amountCents` is an integer number in the API (the database's `bigint` is converted; the cap keeps it exact).
- Both apps import the schemas and the types inferred from them. The API validates every body with them; the UI validates the form with the same ones.

## How the two apps meet

- **Dev:** the web app calls `/api/…`. Vite proxies `/api` to the API (`http://localhost:${API_PORT}`, default 3000), so the browser sees one origin and the API needs no CORS.
- **The user picker** is a fixed list of the four seeded users in the web app (dev stub), stored in `localStorage` and sent as `X-User-Id`. There is no endpoint that lists users across companies, on purpose.

## What lands on main before the two issues (L1, small)

- **`packages/shared` becomes ESM** and gets `zod@^4.6.7`. The current major is 4, `"type": "module"`, checked 2026-11-20. It gets the schemas above, their inferred types and tests.
- **Both apps depend on it** (`workspace:*`). `apps/api` moves its `values.ts` lists there.
- **The two factory issues** are then filed from this contract:
  - **API:** routes, services and isolation tests.
  - **UI:** picker, lists, form and actions, with tests.
