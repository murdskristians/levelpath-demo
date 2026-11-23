# CI and automated review on every PR

> Issue: none · Type: chore · Intent: docs/intent/ci-automated-review.md

## Summary

- GitHub Actions runs the gate (`factory/checks.sh`, with Postgres) on every PR to `main`.
- Harness tests and mock evals run only when their paths change; one always-running summary job is the single required check.
- A Claude review comment (advisory, capped, same-repo branches only) follows `REVIEW.md`.
- A manual `workflow_dispatch` workflow runs the evals against the real model and reports the pass rate; nothing automatic ever calls the real model.
- Docs say what branch protection enforces and what it can't (approvals stay 0, D9).

## Context

- There is no `.github/` directory today. Nothing on GitHub checks a PR.
- The gate: `factory/checks.sh` (protected; install, build, lint, test, plus the U+FFFD check). API tests need Postgres and create their own `lp_<random>` database (`apps/api/test/`); `docker-compose.yml` defines Postgres 18 and `pnpm db:up` starts it. Node >= 24, pnpm 10.26.1 (`package.json`).
- Harness tests: `python3 .claude/hooks/test_hooks.py` and `factory/tests/run_test.py` (offline, stdlib).
- Evals: `pnpm eval -- --api <url>` (`evals/run.mjs`) calls a running API's `POST /purchase-requests/suggestion`; against the mock all 15 cases pass and it exits 0 whatever the rate (1 only when it can't run). The API uses the mock unless `LLM_PROVIDER=anthropic` (`apps/api/src/suggestions/llm-config.ts`). LLM prompt file: `apps/api/src/suggestions/prompt.ts`.
- Review rules: `REVIEW.md` (protected). `docs/HARNESS_CHANGELOG.md` line 228 promises CI runs the harness tests.

## Requirements

1. A workflow `.github/workflows/ci.yml` triggers on `pull_request` to `main` (never `pull_request_target`) with `permissions: contents: read` and no secrets.
2. Job `gate` runs `bash factory/checks.sh` itself (not a copy of its steps) with Postgres available, after setting up Node 24 and pnpm. The checkout has full history only if the gate needs it; `git grep` needs none.
3. A job `changes` decides from the PR's changed files (plain `git diff`, no third-party path action) whether harness tests and mock evals apply:
   - harness tests: `.claude/**`, `factory/**`, `adws/**`;
   - mock evals: `CLAUDE.md`, `.claude/**`, `apps/api/src/suggestions/prompt.ts`, `evals/**`.
4. Job `harness-tests` (when it applies) runs both Python test scripts with stdlib `python3`.
5. Job `mock-evals` (when it applies) migrates and seeds a Postgres, starts the API with `LLM_PROVIDER=mock` on a fixed port, waits for it to listen, runs `pnpm eval -- --api http://localhost:<port>`, and fails unless all cases pass (the runner exits 0 whatever the rate, so the job must check the reported pass count itself). The job never sets `ANTHROPIC_API_KEY`.
6. A final job `ci` (`if: always()`, `needs` all jobs above) fails when any needed job's result is `failure` or `cancelled`, and succeeds when jobs passed or were skipped. `ci` is the one check name that branch protection requires.
7. A separate workflow `.github/workflows/review.yml` runs Claude review on `pull_request` only when the head repo is this repo (`github.event.pull_request.head.repo.full_name == github.repository`), using `anthropics/claude-code-action` with the `ANTHROPIC_API_KEY` secret, a capped `--max-turns`, and a prompt telling it to follow `REVIEW.md` and post findings as Important and Nit. It posts one comment, edited in place on later pushes. It is not part of `ci` and not required. A missing secret or a review failure never fails or blocks the PR (job `continue-on-error`, or skipped when the secret is empty).
8. A workflow `.github/workflows/evals-real.yml` with only `workflow_dispatch` starts the API with `LLM_PROVIDER=anthropic` and the secret, runs `pnpm eval`, and writes the pass rate to the job summary. It never fails the run on a low rate, and has no `pull_request`, `push` or `schedule` trigger.
9. Every action is pinned to a major version (or commit SHA) checked at plan time; no secret is echoed, and `.env` is not used in CI.
10. Docs: a section in `docs/HARNESS.md` (what CI runs, which paths, the manual real eval, the secret Chris adds, the exact `gh api` command or Settings steps that make `ci` required on `main` with 0 required approvals, and why: Chris alone merges, `guard.py` stops agents approving or merging (D9), a PR author cannot approve their own PR; plus what protection cannot do, such as admins bypassing it or the advisory review being only advice). `CLAUDE.md` Commands/Harness section mentions CI. `docs/HARNESS_CHANGELOG.md` gets an entry (before, after, why). `docs/LEARNING.md` gets the new concepts (required summary job for path-filtered checks; why `pull_request_target` is avoided on a public repo).

## Acceptance criteria

1. `python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml` (or `actionlint` if available) parses all three files; `pnpm lint` still prints `All matched files use Prettier code style!` with the workflow files included.
2. `grep -rn "pull_request_target" .github` returns nothing; `grep -n "secrets\." .github/workflows/ci.yml` returns nothing.
3. `grep -n "factory/checks.sh" .github/workflows/ci.yml` shows the gate job runs the script; no copied `pnpm build`/`pnpm lint` step appears in that job.
4. Opening a PR that changes only `apps/web/**` shows checks `gate`, `ci` run and `harness-tests`, `mock-evals` skipped, and `ci` green.
5. A PR touching `.claude/**` runs `harness-tests` and `mock-evals`; both green on the unchanged harness. A PR touching `factory/**` runs `harness-tests` only.
6. A PR that breaks a test (or adds a U+FFFD character) turns `gate` red and `ci` red. A PR where `harness-tests` fails turns `ci` red. (Verify on a scratch branch or by inspecting the `ci` job's `if`/script with sample `needs` results; the job must not pass on `failure`.)
7. In `mock-evals`, the log shows `15 cases against http://localhost:<port>` and a 15/15 pass count; changing the job's check to require a higher count than cases would fail it (the job derives pass/fail from the runner's output, not its exit code).
8. `grep -n "ANTHROPIC_API_KEY" .github/workflows/*.yml` matches only `review.yml` and `evals-real.yml`; `evals-real.yml` has only `workflow_dispatch` under `on:`.
9. `review.yml` has the same-repo `if` condition, a `max-turns` cap, and edits one comment in place (`use_sticky_comment` or the action's equivalent, verified against the pinned version). A PR from a fork shows the review job skipped.
10. `docs/HARNESS.md` contains the CI section with the required-check command; running it is Chris's step and is not run by the build. `grep -n "D9" docs/HARNESS.md` finds the approvals explanation.
11. `docs/HARNESS_CHANGELOG.md` and `docs/LEARNING.md` have the new entries; `CLAUDE.md` names CI. `pnpm lint` passes.
12. No file in `protected_paths` (`factory/checks.sh`, `factory/config.json`, `factory/bin/*`, `REVIEW.md`, `.claude/hooks/*`, `.claude/settings.json`) and no app code, migration or test is changed: `git diff --stat origin/main` lists only `.github/**`, `docs/**`, `CLAUDE.md`.

## Tenant isolation and security

- Tenants and RLS: not affected; no app, database or schema change. CI's Postgres is a throwaway service container with dev-only credentials from `.env.sample` defaults.
- Public repo: the `pull_request` trigger gives fork PRs a read-only token and no secrets; no `pull_request_target`, no checkout of PR code with secrets. The review job only runs for same-repo branches. Workflows declare minimal `permissions` (the review job adds `pull-requests: write` and `contents: read` only).
- Secrets: `ANTHROPIC_API_KEY` is used only by the review and manual real-eval workflows, never passed to `ci.yml`, never echoed. PR titles, branch names and bodies are not interpolated into `run:` scripts (use `env:` indirection) to avoid script injection.
- No automatic path ever calls the real model except the capped advisory review.
- Branch protection is a repository setting changed by Chris, not by this change.

## Out of scope

- Deploys, preview environments, caching beyond the setup actions' defaults.
- Changing the factory, the ADWs, review agents, `factory/checks.sh` or `REVIEW.md`.
- Automatic real-model evals, skill-trigger checks that call `claude -p`.
- Required reviewer approvals, CODEOWNERS, signed commits.
- Applying branch protection from the build (documented only).

## Assumptions

- Required-check design: one always-running summary job `ci` (with path detection by `git diff` in a `changes` job) is the single required check; it avoids waiting forever on skipped path-filtered jobs.
- Mock-eval path triggers also include `apps/api/src/suggestions/prompt.ts` and `evals/**`, the LLM prompt and eval files.
- The review comment is one sticky comment edited on each push, to keep PRs readable.
- The manual real-eval workflow reports the pass rate in the job summary only; recording results in docs stays manual.
- Branch protection is applied by Chris (agents may not change repo settings); the docs give the exact command.
- Action versions are chosen by the plan from `gh api`/release checks at plan time.
