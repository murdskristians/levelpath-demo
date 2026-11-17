---
description: Run a PR's branch locally in its own worktree so Chris can check it before merging. The human check every driver ends with.
argument-hint: <pr-number>
---

# Try a PR

Every driver ends with a PR that only Chris merges. This command runs that PR
on Chris's machine without touching the main checkout: the factory and the
ADWs read their scripts and agents from it while they run.

## Variables

pr: $1

## Steps

1. If no PR number is given, stop and run `gh pr list` to show the open PRs.
2. `gh pr view <pr> --json headRefName,title,body,labels` to get the branch.
3. Fetch it and make a worktree: `git fetch origin <branch>`, then
   `git worktree add .worktrees/try-<pr> origin/<branch>` (a detached
   checkout; nothing can be committed from it by accident). If the job's own
   worktree still exists (`.worktrees/<job>` or `trees/<adw_id>`), use that
   instead.
4. In the worktree: `pnpm install --frozen-lockfile`, then start the app in
   the background on the ports reserved for trying:
   `API_PORT=5080 pnpm --filter @levelpath/api dev` and
   `pnpm --filter @levelpath/web dev --port 5081 --strictPort`.
5. Open http://localhost:5081 in the browser (`start http://localhost:5081` on
   Windows).
6. Show Chris what to check. Use the decision's "For the human" section from
   the PR comment the factory or the ADW posted, and the acceptance criteria
   in `docs/specs/` on the branch.

## When Chris is done

Stop the servers with `factory/bin/port stop 5080` and `factory/bin/port stop 5081`.
Then run `git worktree remove .worktrees/try-<pr>`, unless it was the job's own
worktree. Merging happens on GitHub, by Chris. Never run `gh pr merge`.
