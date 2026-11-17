---
description: L1. Turn docs/intent/<slug>.md into docs/specs/<slug>.md with the planner agent (what, plus testable acceptance criteria)
argument-hint: <slug> [feature|bug|chore]
---

# Spec

Write the spec for an intent with the `planner` agent: the same agent and the
same files the factory and the ADWs use, run by you instead of a driver.

## Variables

slug: $1
type: $2 (feature, bug or chore; ask Chris if it isn't given and isn't obvious)

## Steps

1. Read `docs/intent/<slug>.md`. If it doesn't exist, stop and suggest
   `/intent`.
2. Create the job folder `agents/<slug>/` in the main checkout (git-ignored).
   Write:
   - `issue.md`: the intent file's text, quoted as data under a
     `# Intent <slug>` heading.
   - `intake.md`: what intake would write for a run, from the intent and the
     code. The header lines are `DECISION: ACCEPT`, `TYPE: <type>`,
     `RISK: low|medium|high`, `SURFACES: api, ui, db, llm, security (any) | none`
     and `RESCOPED: no`, then a `## Scope` section summarising the intent.
     Tell Chris the risk and surfaces you chose.
3. Spawn the `planner` agent with this prompt:

   ```
   Job: <slug>. Job folder: <repo>/agents/<slug>/. Main checkout: <repo>. Worktree: <repo>. Branch: <current branch>. Base: origin/main. Issue: none.
   Write spec.md only.
   ```

4. Copy `agents/<slug>/spec.md` to `docs/specs/<slug>.md` and run
   `pnpm exec prettier --write docs/specs/<slug>.md`.
5. Show Chris the Summary and the acceptance criteria, and ask for changes.
   Edit `docs/specs/<slug>.md` directly for small ones. It is the source of
   truth from now on.

## Report

The spec path, the number of requirements and criteria, the assumptions the
planner made, and the next step: `/plan <slug>`.
