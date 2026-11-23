#!/usr/bin/env bash
# The repo's checks: the gate every driver runs (factory, ADWs, /verify).
# Exit 0 only when the branch is fit to review.
#
# The gate runs this script from the main checkout with the job's worktree as
# the working directory, so a branch can't change the checks it is judged by.
# Fast, deterministic, non-interactive: no watch modes, nothing that rewrites
# files (`pnpm lint` only checks: eslint . && prettier --check .).
#
# Phase 2 adds the RLS isolation suite here, against a database per run.
set -euo pipefail

# A replacement character (U+FFFD) means text was written in the wrong encoding.
# Prettier and the tests don't notice it; job 003 merged one into CLAUDE.md.
# git grep exits 0 on a match, 1 on none, and above 1 when it can't search:
# that fails the gate too, so the check can't pass by not running.
found=0
git grep --untracked -nI $'\xEF\xBF\xBD' -- . ':!pnpm-lock.yaml' || found=$?
if [ "$found" -eq 0 ]; then
  echo "checks: U+FFFD (a broken character) in the files above; rewrite them as UTF-8" >&2
  exit 1
elif [ "$found" -ne 1 ]; then
  echo "checks: the U+FFFD check could not run (git grep exit $found)" >&2
  exit 1
fi

pnpm install --frozen-lockfile --prefer-offline
pnpm build
pnpm lint
pnpm test
