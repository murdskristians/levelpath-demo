# Plan: Web: clearer button names, sentence-case error, New request form in view

> Spec: factory/jobs/004-web-clearer-button-names/spec.md · Type: feature

## Approach

Small edits in place: `aria-label` on the three buttons, the one schema message, and the form moved above the list with a focus effect on Title. `aria-label` beats visually-hidden spans because the visible text and DOM stay unchanged. Existing codebase pattern for names is `Comment on ${title}`.

## Libraries and versions

None.

## Files

- `packages/shared/src/purchase-requests.ts` — message (line 58) becomes `'A rejection needs a comment.'`.
- `apps/web/src/components/RequestList.tsx` — `aria-label={`Submit ${r.title}`}` on the Submit button.
- `apps/web/src/components/DecisionQueue.tsx` — `aria-label` `Approve ${request.title}` / `Reject ${request.title}`.
- `apps/web/src/components/NewRequestForm.tsx` — a ref on the Title input and `useEffect(() => titleRef.current?.focus(), [])`.
- `apps/web/src/App.tsx` — render the form (when `formOpen`) before `RequestList`; keep the "New request" button where it is when closed.
- `apps/web/src/App.test.tsx` — update lookups of `'Submit'`, `'Approve'`, `'Reject'` (lines ~149-181, 524-547, 569, 587) to the titled names; update the error text at line 541; add the new tests.
- `docs/specs/003-web-purchase-requests-user.md` — line 46 quotes the new text.
- `docs/HARNESS_CHANGELOG.md` — only if something is corrected; none expected.

## Steps

### 1. Shared message

- Change the string in `decisionSchema`. Check `apps/api` tests and `packages/shared` tests for the old text (grep found none in the API). Run `pnpm --filter @levelpath/shared build`.

### 2. Buttons

- Add the `aria-label`s. Note `getByRole(..., { name: 'Submit' })` matches the full name exactly, so the old lookups must change to the titled names.
- Tests: criteria 1-3, including two waiting requests to show names are unique.

### 3. New request form

- Move the form above `RequestList` in `App.tsx`; focus Title in `NewRequestForm` on mount.
- Tests: criterion 5 (focus on Title, form before the list). Do not call `scrollIntoView` (jsdom lacks it).

### 4. Docs and criterion 4

- Update the spec line in `docs/specs/003-...`. Add an assertion that the new message parses through `apiErrorSchema` (e.g. in `apps/web/src/shared.test.ts`).

### 5. Validate

Run the validation commands below.

## Tests

- Accessible names for Submit, Approve, Reject with text unchanged and unique across cards.
- Empty-comment rejection shows `A rejection needs a comment.`, no POST.
- Title focused after clicking New request; form precedes the list.
- `apiErrorSchema` parses a 400 body with the new message.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

## Notes

- The API tests need Postgres (`pnpm db:up`).
- Do not touch `apps/api` source.
