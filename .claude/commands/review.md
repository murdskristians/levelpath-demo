---
description: L1. Run reviewer-bugs, reviewer-spec and reviewer-security in parallel on the current branch and merge their findings by REVIEW.md (Important first, nit cap)
argument-hint: <slug>
---

# Review

Review the change on the current branch with the same three reviewer agents
the factory and the ADWs use, then merge what they found into one list.

## Variables

slug: $1

## Steps

1. Use the round folder of the last `/verify <slug>` run when its
   `checks.md` has `COMMIT:` equal to what `factory/bin/gate --tree <repo>`
   prints now (the commit plus a hash of the uncommitted changes, so an edit
   since `/verify` counts as new code). Otherwise run the gate for the next
   round as in `/verify` steps 2 and 3. Reviewers start only on a passing gate.
2. Spawn `reviewer-bugs`, `reviewer-spec` and `reviewer-security` **in one
   message**, so they run in parallel, each with this prompt:

   ```
   Job: <slug>. Job folder: <repo>/agents/<slug>/. Main checkout: <repo>. Worktree: <repo>. Branch: <current branch>. Base: origin/main. Issue: none.
   Review round <N>.
   ```

   **Wait for all three.**
3. Check that `round-<N>/review-bugs.md`, `review-spec.md` and
   `review-security.md` exist. For each one missing, resume that reviewer once
   with SendMessage, saying that its file is missing and it must write
   `round-<N>/review-<r>.md` now with the Write tool, from the review it
   already did, without reviewing again. If it is still missing, tell Chris.
   Never write a review file yourself, not even from the reviewer's reply.
4. Read the three files (and `review-verify.md` if `/verify` ran this round).
5. Merge their findings:
   - Important first, then Nits.
   - Combine findings that point at the same line and problem, naming every
     reviewer that found it.
   - Keep at most 5 Nits in total, the most useful ones.

## Report

```
Review round <N> of <slug>: <PASS | CHANGES>
  bugs: <verdict>  spec: <verdict>  security: <verdict>  [verify: <verdict>]

Important
1. <path:line> <problem> → <fix>   (<reviewers>)

Nits
1. ...
```

Then ask Chris which findings to fix. Fixing is a normal edit; run `/review`
again afterwards for the next round.
