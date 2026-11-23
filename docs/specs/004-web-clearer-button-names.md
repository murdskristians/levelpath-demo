# Web: clearer button names, sentence-case error, New request form in view

> Issue #10: Web: clearer button names, sentence-case errors, New request form in view · Type: feature

## Summary

- Submit, Approve and Reject buttons keep their visible text; their accessible names include the request title.
- The rejection error reads "A rejection needs a comment."
- Clicking "New request" shows the form above the list and focuses its Title field.
- No change to `apps/api` routes or to the contract's shapes.

## Context

- `apps/web/src/components/RequestList.tsx`: the Submit button on each card (line ~51).
- `apps/web/src/components/DecisionQueue.tsx`: the Approve and Reject buttons (line ~46); the comment box is already named `Comment on <title>`.
- `apps/web/src/App.tsx`: renders `RequestList`, then the `NewRequestForm` (or the "New request" button) below it.
- `apps/web/src/components/NewRequestForm.tsx`: the form; Title is `<input id="title">`.
- `packages/shared/src/purchase-requests.ts:58`: `decisionSchema` message `'a rejection needs a comment'`. `DecisionQueue` shows the schema's message.
- Old text is quoted in `apps/web/src/App.test.tsx:541` and `docs/specs/003-web-purchase-requests-user.md:46`.

## Requirements

1. The Submit button on a request card has the accessible name `Submit <title>`; visible text stays "Submit".
2. The Approve and Reject buttons in the decision queue have the accessible names `Approve <title>` and `Reject <title>`; visible text stays.
3. The `decisionSchema` message becomes `A rejection needs a comment.`, so the web error shows it. The API's 400 still parses with `apiErrorSchema`.
4. When the user clicks "New request", the form renders above the request list and keyboard focus moves to the Title field.
5. Tests for each of the three changes. Existing tests that looked buttons up by the bare names are updated to the new names.

## Acceptance criteria

1. In a rendered `App` with a request titled "Laptops" in draft, `screen.getByRole('button', { name: 'Submit Laptops' })` finds one button whose text content is "Submit". Verify: `pnpm --filter @levelpath/web test`.
2. For an approver with a waiting request "Monitors", `getByRole('button', { name: 'Approve Monitors' })` and `getByRole('button', { name: 'Reject Monitors' })` each find one button, with text "Approve" and "Reject". With two waiting requests, each name matches exactly one button.
3. Clicking Reject with an empty comment shows the text `A rejection needs a comment.` (and the lowercase text is gone); no POST is sent. Verify with the web test.
4. `decisionSchema.safeParse({ decision: 'rejected' })` fails with the message `A rejection needs a comment.`. A test in `apps/web/src/shared.test.ts` or the API validation spec still passes and an API 400 body carrying that message parses with `apiErrorSchema`.
5. After clicking "New request", `getByLabelText('Title')` is `document.activeElement`, and the form appears before the request list in document order (`compareDocumentPosition`). Verify with the web test.
6. `git diff --stat origin/main` shows no change under `apps/api/src` routes or the contract's schema shapes (only the one message string).

## Tenant isolation and security

Not affected: UI labels and one message string; no data access, no new input, no tenant data. `X-User-Id` handling is unchanged.

## Out of scope

- Other error messages, API routes, the contract's shapes.
- Renaming visible button text, or changing the comment box labels.
- Scroll-into-view logic (the form is above the list, so it is already in view).

## Assumptions

- Accessible names are `<Verb> <title>`, using `aria-label`, matching the issue's example "Approve 20 laptops for new sales hires".
- Placing the form above the list satisfies "in view"; focus on Title is added too (both options in the issue are done, cheaply).
- The message gets a full stop; the spec line in `docs/specs/003-web-purchase-requests-user.md` is updated to match.
