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

pnpm install --frozen-lockfile --prefer-offline
pnpm build
pnpm lint
pnpm test
