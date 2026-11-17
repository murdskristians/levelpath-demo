---
description: Brainstorm a feature with Chris and write docs/intent/<slug>.md; optionally file it as a GitHub issue for the factory or the ADWs
argument-hint: <rough idea>
---

# Intent

Turn Chris's rough idea into `docs/intent/<slug>.md`: why and for whom, not how.
This is the first step of every driver. In L1 (pairing) `/spec` continues from
it; in L2 and L3 it becomes the GitHub issue.

## Idea

$ARGUMENTS

## Steps

1. Read `CLAUDE.md` and skim the code the idea touches, so your questions are
   about decisions, not facts you could look up.
2. Ask Chris the questions that change the outcome, **one at a time**, each
   with your suggested answer: who it is for (tenants, `requester` or
   `approver`), what is true when it's done, what is out of scope, and any
   constraint (tenant isolation, cost, the mock LLM provider). Stop when the
   outcome is clear; three to five questions is usually enough.
3. Pick a short kebab-case slug and write `docs/intent/<slug>.md` from
   `docs/templates/intent.md`. Keep Chris's words where they are clear.
4. Show Chris the file and ask which driver should take it from here:
   - **L1, pair:** run `/spec <slug>` next.
   - **L2, factory:** `gh issue create --label factory --title "<title>" --body-file docs/intent/<slug>.md`, then `/factory run <n>`.
   - **L3, ADW:** `gh issue create --title "<title>" --body-file docs/intent/<slug>.md`, then Chris comments `adw` on it (with the trigger running), or runs `uv run adws/adw_sdlc_iso.py <n>`.

   Create the issue only when Chris says so; creating it is public.

## Report

The path of the intent file, and the next command for the driver Chris chose.
