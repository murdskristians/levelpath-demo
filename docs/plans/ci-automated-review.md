# Plan: CI and automated review on every PR

> Spec: agents/ci-automated-review/spec.md · Type: chore

## Approach

Three workflow files plus docs. `ci.yml` has jobs `changes`, `gate`, `harness-tests`, `mock-evals` and the always-running `ci` summary, the one required check. Path filtering is done by a plain `git diff --name-only` in `changes`, so a skipped job never leaves a required check pending. The review and the real-model eval live in separate workflows so `ci.yml` never sees a secret. No app code, test or protected file changes.

## Libraries and versions

Checked at plan time with `gh api repos/<repo>/releases/latest` (GitHub Actions, not npm; JavaScript or composite actions, no module-format concern):

- `actions/checkout@v7` (latest v7.0.1)
- `actions/setup-node@v7` (latest v7.1.0), `node-version: 24`
- `pnpm/action-setup@v6` (latest v6.1.1); `version` is omitted so it reads `packageManager` (pnpm 10.26.1) from `package.json`. The builder verifies that `package.json` has `packageManager`; if not, pass `version: 10.26.1`.
- `anthropics/claude-code-action@v1` (floating major tag v1). Its `action.yml` has inputs `anthropic_api_key`, `prompt`, `claude_args`, `use_sticky_comment`, `github_token`, `track_progress`, `allow_fork_prs`, `restrict_untrusted_prs`. Max turns goes in `claude_args: --max-turns 8`.
- `actions/upload-artifact` is not needed.
- Postgres: `postgres:18-alpine` service container, the same image as `docker-compose.yml`.
- Python: the runner's preinstalled `python3` (stdlib only). Use `ubuntu-latest`.

The builder re-runs `gh api repos/<repo>/releases/latest --jq .tag_name` for each action before writing, and uses the current major.

## Files

- `docs/HARNESS.md` — add a "CI" section (see step 4).
- `docs/HARNESS_CHANGELOG.md` — new entry (before: line 228 promised CI but there was none; after: workflows; why).
- `docs/LEARNING.md` — two new concepts.
- `CLAUDE.md` — Harness section (and Commands note) names CI.

### New files

- `.github/workflows/ci.yml`
- `.github/workflows/review.yml`
- `.github/workflows/evals-real.yml`

## Steps

### 1. `ci.yml`

- `on: pull_request: branches: [main]`; top-level `permissions: contents: read`; `concurrency` per ref with `cancel-in-progress: true`. No secrets referenced anywhere in this file.
- Job `changes` (`outputs: harness`, `evals`): `actions/checkout` with `fetch-depth: 0`, then a `run:` that takes `BASE_SHA: ${{ github.event.pull_request.base.sha }}` via `env:` and runs `git diff --name-only "$BASE_SHA"...HEAD`. Use `grep -Eq` against these patterns and write `harness=true|false` and `evals=true|false` to `$GITHUB_OUTPUT`:
  - harness: `^(\.claude|factory|adws)/`
  - evals: `^(CLAUDE\.md$|\.claude/|apps/api/src/suggestions/prompt\.ts$|evals/)`
- Job `gate`: checkout (default depth), `pnpm/action-setup`, `actions/setup-node` (24, `cache: pnpm`), service `postgres` (env from `.env.sample` defaults: `POSTGRES_DB=levelpath`, `POSTGRES_USER=levelpath_owner`, `POSTGRES_PASSWORD=levelpath_dev_password`, port 5432, `--health-cmd pg_isready` options), then one step `run: bash factory/checks.sh`. No other pnpm steps in this job. Defaults (host localhost, port 5432) match the API test setup, which the builder confirms in `apps/api/test/`.
- Job `harness-tests`: `needs: changes`, `if: needs.changes.outputs.harness == 'true'`; checkout; `python3 -X utf8 .claude/hooks/test_hooks.py`; `python3 -X utf8 factory/tests/run_test.py` (as run locally; both set their own git identity).
- Job `mock-evals`: `needs: changes`, `if: needs.changes.outputs.evals == 'true'`; same Postgres service and Node/pnpm setup; steps: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm db:migrate`, `pnpm db:seed`, start the API in the background (`LLM_PROVIDER=mock API_PORT=3100 pnpm --filter @levelpath/api start > api.log 2>&1 &`), wait up to 30 s with a curl loop on `http://localhost:3100/health` (`curl -sf`; on timeout print `api.log` and fail), then `pnpm eval -- --api http://localhost:3100 | tee eval.log`, then a check step: parse `pass rate: P/N` from `eval.log` with `grep -Eo`, and fail unless `N` is 15 or more and `P` equals `N` (derive N from the log's `N cases against` line; fail if the line or the pass-rate line is missing). Print `api.log` on failure. The job sets no `ANTHROPIC_API_KEY`.
- Job `ci`: `needs: [changes, gate, harness-tests, mock-evals]`, `if: always()`, one step with `env: RESULTS: ${{ toJSON(needs.*.result) }}` that fails when it contains `failure` or `cancelled` (plain `grep -Eq`), else prints the results and exits 0.
- Test it: validate YAML (criterion 1); simulate the `changes` script locally with `git diff --name-only` on sample file lists; simulate the `ci` script with `RESULTS='["success","skipped"]'` (exit 0) and `'["success","failure"]'` and `'["cancelled"]'` (exit 1). Do the same for the eval check against a sample log (15/15 passes, 14/15 fails, missing line fails).

### 2. `review.yml`

- `on: pull_request: types: [opened, synchronize, reopened]`; `permissions: contents: read, pull-requests: write`. One job `review`, `if: github.event.pull_request.head.repo.full_name == github.repository`, `continue-on-error: true`, `timeout-minutes: 15`. Skipped when the secret is empty: a first step `env: KEY: ${{ secrets.ANTHROPIC_API_KEY }}` sets `has_key` output from `[ -n "$KEY" ]` (the value is never printed), and later steps `if: steps.key.outputs.has_key == 'true'`.
- Checkout (`fetch-depth: 0`, `persist-credentials: false`), then `anthropics/claude-code-action@v1` with `anthropic_api_key`, `use_sticky_comment: true`, `claude_args: --max-turns 8`, and a `prompt` that says: review this PR against `REVIEW.md`, read the diff against the base branch, post one comment listing findings as Important and Nit, advisory only. The prompt contains only static text; PR title, body and branch name are not interpolated.
- The builder confirms against the pinned major's README or `action.yml` that `use_sticky_comment` applies to `pull_request` events and, if the action needs `id-token: write` or `pull-requests: write` beyond the above, adds only those.

### 3. `evals-real.yml`

- `on: workflow_dispatch` only; `permissions: contents: read`. One job: checkout, setup pnpm and Node, Postgres service as in `ci.yml`, `pnpm install --frozen-lockfile`, `pnpm build`, `db:migrate`, `db:seed`, start the API with `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}` set via the step `env:` of the start step only, wait for it, then `pnpm eval -- --api http://localhost:3100 | tee eval.log || true`; append `eval.log` with its pass-rate line to `$GITHUB_STEP_SUMMARY`. It never fails on a low rate (a run that cannot start the API may still fail).

### 4. Docs

- `docs/HARNESS.md`: a "CI" section placed before "Try it": a table of workflow, trigger, paths, secret; the manual real eval and how to run it (`gh workflow run evals-real.yml`); the secret Chris adds (`gh secret set ANTHROPIC_API_KEY`); the required-check command using the REST API, with `required_status_checks` `contexts: ["ci"]`, `strict: false`, `enforce_admins: false`, `required_pull_request_reviews: null` (0 required approvals) and `restrictions: null`, via `gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input -`, plus the Settings path (Settings → Branches → Rules); why approvals stay 0 (D9: Chris alone merges, `guard.py` stops agents approving or merging, a PR author cannot approve their own PR); what protection cannot do (admin bypass, the review being advice, path-filtered jobs depending on `changes`). Say the command is run by Chris, not by the build.
- `docs/HARNESS_CHANGELOG.md`: read the file, add the entry at the end in the file's existing format (before → after → why), and mention it fulfils the line-228 promise.
- `docs/LEARNING.md`: two concepts: the required summary job for path-filtered checks (skipped jobs are not "failed" nor "passed" to branch protection, so require one `if: always()` job); `pull_request` vs `pull_request_target` on a public repo (the latter runs with secrets and a write token in the base context, which is dangerous with untrusted PR code).
- `CLAUDE.md`: one line in "The harness" naming CI (`.github/workflows/`: `ci` is the required check; review and real evals are separate). Read the whole file first.

### 5. Validate

Run the validation commands. Check criteria 1, 2, 3, 8, 9 and 12 with the greps in the spec. Criteria 4 to 7 need a real PR; do the local simulations from step 1 and say in the handoff that the first PR proves them.

## Tests

No app tests change. The checks are the local simulations of the `changes`, `ci` and eval-check scripts above (run in a scratch shell, not committed) and `pnpm lint` (Prettier covers the YAML and Markdown). To keep the scripts testable, keep each one short and inline in the YAML.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml
grep -rn "pull_request_target" .github
grep -n "secrets\." .github/workflows/ci.yml
grep -n "factory/checks.sh" .github/workflows/ci.yml
grep -n "ANTHROPIC_API_KEY" .github/workflows/*.yml
git diff --stat origin/main
```

## Notes

- Do not edit protected files (`factory/checks.sh`, `REVIEW.md`, `.claude/hooks/*`, and so on). Do not run the branch-protection command.
- If PyYAML is missing, use `actionlint` or `node -e` with the `yaml` package from the pnpm store; do not add a dependency.
- Prettier formats YAML: run `pnpm exec prettier --write .github docs CLAUDE.md` before `pnpm lint`.
- Use `env:` indirection for any `${{ }}` value used in a `run:` script.
- The readiness probe is `GET /health` (public, returns `{"status":"ok"}`), the same one the verifier and `/try` use.
