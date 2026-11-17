---
description: L1. Turn docs/specs/<slug>.md into docs/plans/<slug>.md with the planner agent (how, plus checked library versions), and set the task type for the test lock
argument-hint: <slug>
---

# Plan

Write the implementation plan for a spec with the `planner` agent, then wait
for Chris's approval before any file is edited (KICKOFF: plan before code).

## Variables

slug: $1

## Steps

1. Read `docs/specs/<slug>.md`. If it doesn't exist, stop and suggest
   `/spec <slug>`.
2. Copy it into the job folder as `agents/<slug>/spec.md`. Chris may have
   edited the docs copy; it wins.
3. Read `TYPE:` from `agents/<slug>/intake.md` and write it to
   `.claude/task-type`: `feature`, `bug` or `chore`. The guard hook reads this
   file. For `bug`, edits to test files that already exist on `origin/main`
   are blocked until the task type changes, so the fix goes in the code and a
   new regression test proves it.
4. Spawn the `planner` agent with this prompt:

   ```
   Job: <slug>. Job folder: <repo>/agents/<slug>/. Main checkout: <repo>. Worktree: <repo>. Branch: <current branch>. Base: origin/main. Issue: none.
   spec.md is final. Write plan.md only.
   ```

5. Copy `agents/<slug>/plan.md` to `docs/plans/<slug>.md` and run
   `pnpm exec prettier --write docs/plans/<slug>.md`.
6. Show Chris the approach, the files, the libraries and versions checked, and
   the steps. **Stop and wait for approval.** Don't edit code in this command.

## After approval

Build it together in this session, following `docs/plans/<slug>.md` and the
skills it names. Then run `/verify <slug>` and `/review <slug>`. When it's
merged, set `.claude/task-type` back to `feature`.
