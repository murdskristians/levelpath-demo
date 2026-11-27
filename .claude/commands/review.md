---
description: L1. Run the routed reviewers in parallel on the current branch, merge their findings by REVIEW.md (Important first, nit cap), and get the approver's recommendation when all pass
argument-hint: <slug>
---

# Review

Review the change on the current branch with the same reviewer agents, models
and approver the factory and the ADWs use for this job's risk, then merge what
they found into one list.

## Variables

slug: $1

## Steps

1. `/verify <slug>` comes first. Use the round folder of the last `/verify`
   run when it has `review-verify.md` and its `checks.md` has `COMMIT:` equal
   to what `factory/bin/gate --tree <repo>` prints now (the commit plus a
   hash of the uncommitted changes, so an edit since `/verify` counts as new
   code). Otherwise **stop**: tell Chris to run `/verify <slug>` first, and
   why (no verify round, or the code changed since it). Don't run the gate or
   any reviewer yourself. In the factory and the ADWs the verifier always
   runs in the same round, and the approver needs its review.
2. Read the reviewers from `agents/<slug>/agents.json` `reviewers` (written by
   `/spec`): every key except `verify` (the verifier ran in `/verify`), with
   its model. Without `agents.json`, use `bugs`, `spec` and `security` with
   their frontmatter models. Spawn each `reviewer-<key>` **in one message**,
   so they run in parallel, each with its model and this prompt:

   ```
   Job: <slug>. Job folder: <repo>/agents/<slug>/. Main checkout: <repo>. Worktree: <repo>. Branch: <current branch>. Base: origin/main. Issue: none.
   Review round <N>.
   ```

   **Wait for all of them.**
3. Check that each `round-<N>/review-<key>.md` exists. For each one missing,
   resume that reviewer once with SendMessage, saying that its file is
   missing and it must write it now with the Write tool, from the review it
   already did, without reviewing again. If it is still missing, tell Chris.
   Never write a review file yourself, not even from the reviewer's reply.
4. Read every review in the round, `review-verify.md` included.
5. Merge their findings:
   - Important first, then Nits.
   - Combine findings that point at the same line and problem, naming every
     reviewer that found it.
   - Keep at most 5 Nits in total, the most useful ones.
6. If every review in the round, the verifier's included, says
   `VERDICT: PASS`, spawn the `approver` (no model: its frontmatter sets it)
   with:

   ```
   Job: <slug>. Job folder: <repo>/agents/<slug>/. Main checkout: <repo>. Worktree: <repo>. Branch: <current branch>. Base: origin/main. Issue: none. PR: none (pair run, uncommitted). Final round: <N>.
   ```

   It writes `agents/<slug>/decision.md`: `READY` or `ESCALATE`, a
   recommendation for Chris.

## Report

```
Review round <N> of <slug>: <PASS | CHANGES>
  <key>: <verdict>  ...  [verify: <verdict>]
  approver: <READY | ESCALATE> (when all passed)

Important
1. <path:line> <problem> → <fix>   (<reviewers>)

Nits
1. ...
```

On CHANGES, the factory and the ADWs send every Important finding back to the
builder, at most 3 rounds in all. Offer the same: resume the builder (or spawn
`builder` with model `agents.json` `builder`) with
`<header> Build round <N+1>. Ports: API 5090, web 5091. Pair run (L1): leave the changes uncommitted. Round <N> reviews are in round-<N>/. Address every VERDICT: CHANGES and update build.md for round <N+1>.`,
then stop ports 5090 and 5091 and run `/verify` and `/review` again. Chris may
choose differently; it's his call.
