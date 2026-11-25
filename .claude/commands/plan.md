---
description: L1. Show Chris the planner's plan (docs/plans/<slug>.md) for approval, set the task type for the test lock, then have the builder agent build it
argument-hint: <slug>
---

# Plan

Get Chris's approval for the plan before any file is edited (project rule:
plan before code), then build it with the same `builder` agent the factory and
the ADWs use.

## Variables

slug: $1

## Steps

1. Read `docs/specs/<slug>.md` and `agents/<slug>/agents.json`. If either is
   missing, stop and suggest `/spec <slug>`.
2. Copy the spec into the job folder as `agents/<slug>/spec.md`. Chris may have
   edited the docs copy; it wins.
3. Read `TYPE:` from `agents/<slug>/intake.md` and write it to
   `.claude/task-type`: `feature`, `bug` or `chore`. The guard hook reads this
   file. For `bug`, edits to test files that already exist on `origin/main`
   are blocked until the task type changes, so the fix goes in the code and a
   new regression test proves it.
4. The planner already wrote `agents/<slug>/plan.md` in `/spec`. Only if Chris
   changed the spec there, or `plan.md` is missing, spawn the `planner` with
   model `agents.json` `planner` and this prompt:

   ```
   Job: <slug>. Job folder: <repo>/agents/<slug>/. Main checkout: <repo>. Worktree: <repo>. Branch: <current branch>. Base: origin/main. Issue: none.
   spec.md is final. Write plan.md only.
   ```

5. Copy `agents/<slug>/plan.md` to `docs/plans/<slug>.md` and run
   `pnpm exec prettier --write docs/plans/<slug>.md`.
6. Show Chris the approach, the files, the libraries and versions checked, and
   the steps. **Stop and wait for approval.** Don't edit code in this command.

## After approval

The `builder` agent builds it, with the model in `agents.json`. Writing the
code in this chat would carry the whole conversation into every turn on the
chat's model, which made an L1 build cost several times an L2 or L3 one. You
steer: Chris's choices at approval go in the prompt, and you review what comes
back.

1. Copy `docs/plans/<slug>.md` over `agents/<slug>/plan.md` if Chris edited
   it at approval.
2. Spawn `builder` with model `agents.json` `builder` and this prompt:

   ```
   Job: <slug>. Job folder: <repo>/agents/<slug>/. Main checkout: <repo>. Worktree: <repo>. Branch: <current branch>. Base: origin/main. Issue: none.
   Build round 1. Ports: API 5090, web 5091. Pair run (L1): leave the changes uncommitted.
   This is round 1: implement spec.md following plan.md.
   <Chris's choices at plan approval, if any>
   ```

3. When it returns, stop anything left on its ports:
   `factory/bin/port stop 5090` and `factory/bin/port stop 5091`.
4. Show Chris `agents/<slug>/build.md`: the summary, the criteria with their
   evidence, and the deviations from the plan.

Then run `/verify <slug>` and `/review <slug>`. When it's merged, set
`.claude/task-type` back to `feature`.
