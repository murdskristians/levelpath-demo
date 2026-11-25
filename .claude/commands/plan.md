---
description: L1. Turn docs/specs/<slug>.md into docs/plans/<slug>.md with the planner agent (how, plus checked library versions), and set the task type for the test lock
argument-hint: <slug>
---

# Plan

Write the implementation plan for a spec with the `planner` agent, then wait
for Chris's approval before any file is edited (project rule: plan before code).

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

The `builder` agent builds it, the same agent the factory and the ADWs use,
on Sonnet. Writing the code in this chat would carry the whole conversation
into every turn on the chat's model, which made an L1 build cost several
times an L2 or L3 one. You steer: Chris's choices at approval go in the
prompt, and you review what comes back.

1. Copy `docs/plans/<slug>.md` over `agents/<slug>/plan.md` if Chris edited
   it at approval, and add his choices to the prompt below.
2. Spawn `builder` with model `sonnet` and this prompt:

   ```
   Job: <slug>. Job folder: <repo>/agents/<slug>/. Main checkout: <repo>. Worktree: <repo>. Branch: <current branch>. Base: origin/main. Issue: none.
   Build round 1. Ports: API 5090, web 5091. Pair run (L1): leave the changes uncommitted.
   <Chris's choices at plan approval, if any>
   ```

3. When it returns, stop anything left on its ports:
   `factory/bin/port stop 5090` and `factory/bin/port stop 5091`.
4. Show Chris `agents/<slug>/build.md`: the summary, the criteria with their
   evidence, and the deviations from the plan. Small changes he asks for are
   normal edits here; for a larger one, resume the builder with SendMessage.

Then run `/verify <slug>` and `/review <slug>`. When it's merged, set
`.claude/task-type` back to `feature`.
