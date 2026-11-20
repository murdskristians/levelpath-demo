# Intent: Purchase requests, from draft to decision

<!-- Drafted by Claude from KICKOFF Phase 3 and Chris's four decisions (2026-11-20). Chris to confirm. -->

## Problem

Phase 2 built the tenant boundary, but nobody can do anything inside it yet: the only route is `GET /me`, and the web app shows an empty list with a disabled "New request" button. The demo has no workflow to show.

## Outcome

A requester creates a purchase request, sees it in their list and submits it. An approver of the same company sees it waiting, and approves or rejects it with a comment. Switching to the other company's user in the header shows none of it. Everything goes through `withTenant`, so Postgres RLS still decides what each request can touch.

## Users and roles

- **Requester** (Alice at Acme, Bella at Globex): creates drafts, submits them, sees **their own** requests and their status.
- **Approver** (Amir, Boris): sees their own requests too, plus every **submitted** request of their company, and approves or rejects it with a comment.
- **Who you are:** a user picker in the header lists the four seeded users, clearly labelled as a dev stub, and sends the choice as `X-User-Id`.

## Constraints

- **Decided (Chris):**
  - **Visibility:** a requester sees their own requests, and an approver also gets a queue of their company's submitted requests.
  - **The UI login** is a header user picker over the seeded users.
  - **The lifecycle** is create, submit and decide only: no editing or deleting.
  - **The driver** is the factory, with two issues (API and UI) built in parallel worktrees.
- **Carried from Phase 2's review:**
  - Approving or rejecting checks that the caller is an `approver` and is not the request's requester (no self-approval), inside `withTenant`.
  - Postgres generates every `id`; the client never chooses one. A unique (`23505`) or foreign-key (`23503`) violation answers like "not found".
  - Another tenant's id behaves exactly like an id that doesn't exist (404).
  - The role, status and decision lists move to `packages/shared`, next to the Zod schemas both apps use.
- **Contract first:** the request and response shapes are agreed and land on `main` as shared Zod schemas before the two issues start, so the API and the UI can be built at the same time without guessing at each other.
- Every input is validated by a shared Zod schema. Isolation tests for every new route. No mocked database.

## Out of scope

- Editing or deleting requests, attachments, line items, multiple approval steps.
- The LLM suggestion (Phase 4), CI (Phase 5).
- Real authentication; user, supplier or company management.

## Open questions

None for the intent. The contract (`docs/specs/purchase-requests-contract.md`) needs Chris's approval before the issues are filed.
