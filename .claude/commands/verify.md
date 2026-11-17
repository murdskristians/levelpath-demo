---
description: L1. Run the gate, then the verifier agent on the current branch - it runs the app, exercises every acceptance criterion and takes screenshots. Reports only.
argument-hint: <slug>
---

# Verify

Check that the change on the current branch actually works, with the same gate
and the same `verifier` agent the factory and the ADWs run in every round.

## Variables

slug: $1

## Steps

1. Make sure `agents/<slug>/spec.md` is the current spec: copy
   `docs/specs/<slug>.md` over it.
2. Pick the round: one more than the highest `agents/<slug>/round-*` folder.
   Create `agents/<slug>/round-<N>/`.
3. Run the gate on the main checkout:
   `factory/bin/gate --run <repo> <repo>/agents/<slug>/round-<N>`.
   It writes `checks.md` and `checks.log` there. If it prints `GATE: FAIL`,
   show Chris the failing lines from `checks.log` and stop: fix first.
4. Spawn the `verifier` agent with this prompt (ports 5090 and 5091 are
   reserved for L1):

   ```
   Job: <slug>. Job folder: <repo>/agents/<slug>/. Main checkout: <repo>. Worktree: <repo>. Branch: <current branch>. Base: origin/main. Issue: none.
   Review round <N>. Ports: API 5090, web 5091.
   ```

5. Read `agents/<slug>/round-<N>/review-verify.md`.

## Report

The verdict, each acceptance criterion with works or fails, the Important
findings, and the screenshot paths. Don't fix anything in this command; if
Chris asks you to fix something afterwards, that is a normal edit.
