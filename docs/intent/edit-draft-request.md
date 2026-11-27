# Intent: Edit a draft purchase request before submitting it

<!-- Written by /intent with Chris (2026-11-26), from "requesters can edit a draft purchase request before submitting it" and Chris's answers. It names no files on purpose, so the agents have to find the code themselves. -->

## Problem

A requester who spots a mistake in a draft purchase request (a typo in the title, the wrong amount, the wrong supplier) can't fix it. The only actions on a draft are to submit it as it is, or to create a new request and leave the wrong draft behind in their list. Approvers then see requests with errors, and requesters collect drafts they can't change.

## Outcome

In "My requests", every draft has an Edit button next to Submit. It opens the new-request form filled with the draft's values. The requester changes any field and saves: the draft keeps its status, and the list shows the new values. Submitting stays a separate step, as today.

## Users and roles

- **Requesters, in every tenant (Acme Corp and Globex Corp):** edit their own drafts.
- **Nobody else edits a draft.** This includes approvers, other requesters in the same tenant and anyone in another tenant. Submitted, approved and rejected requests can't be edited by anyone.

## Constraints

- **Decided (Chris):**
  - **Who and when:** only the requester who created the request, and only while it is a draft. Anyone else trying gets the same answer as for a request they can't see. Editing a request that is no longer a draft is refused, as submitting it twice is today.
  - **Fields:** every field the create form has (title, amount, currency, supplier, category and description), with the same validation as creating. The client can't change the status, the requester, the tenant or the id.
  - **Suggest fields:** works in the edit form as it does when creating, with the mock LLM provider by default.
  - **UI:** an Edit button on each draft opens the same form, pre-filled. Save keeps it a draft and updates the list. Cancel leaves the draft unchanged.
- **From the repo:**
  - **Tenant isolation is enforced by Postgres RLS**, through the existing tenant-scoped database access, as for every other route. The tenant and the user come from the session, never from the request body or the URL.
  - **The shared contract** is the source of truth for the request body, and both the API and the web form validate with it. The API contract document is updated to match.
  - **No database migration.** The existing table, policies and grants cover it.
  - **Tests:** the API tests cover:
    - editing your own draft;
    - each refusal (another requester, an approver, another tenant with a crafted id, a request that is no longer a draft, invalid fields);
    - that a refused edit changes nothing.

    The web tests cover the Edit button, the pre-filled form, save and cancel.

## Out of scope

- Deleting or discarding a draft.
- An edit history or audit trail. Only the last-updated time changes.
- A conflict check between two open forms: the last save wins.
- Editing a submitted, approved or rejected request, or resubmitting a rejected one.
- Any database change.

## Open questions

- The button and form wording (for example "Edit", "Save changes", "Cancel"), as long as each control's accessible name says what it does.
- Where the edit form appears (in place of the new-request form, or in the list), as long as it is the same form and fields.
