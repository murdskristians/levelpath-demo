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

# The harness's own tests (the hooks, the factory scripts, the ADW pipeline) run when
# the branch changes the harness. There is no CI, so this is the only place they run
# on their own; they take about three minutes, which app-only rounds don't pay.
# Committed changes since the branch left main, uncommitted ones (L1) and new files.
# The root package.json and docker-compose.yml count too: every run uses their
# scripts and their Postgres, and the factory tests check both.
base=origin/main
if git rev-parse -q --verify "$base" >/dev/null; then
  harness=$({ git diff --name-only "$base"...HEAD; git diff --name-only HEAD; git ls-files --others --exclude-standard; } |
    grep -E '^(\.claude|factory|adws)/|^(package\.json|docker-compose\.yml)$' || true)
else
  harness="unknown base: run them"
fi
if [ -n "$harness" ]; then
  echo "checks: the branch changes the harness; running its tests"
  python3 -X utf8 .claude/hooks/test_hooks.py
  python3 -X utf8 factory/tests/run_test.py
  python3 -X utf8 adws/adw_tests/test_pipeline.py
fi
