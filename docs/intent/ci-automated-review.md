# Intent: CI and automated review on every PR

<!-- Written by /intent with Chris (2026-11-23), from KICKOFF Phase 5 and Chris's three decisions. -->

## Problem

Today nothing on GitHub checks a PR. The gate (`factory/checks.sh`) and the review agents run only on the machine that opened it, so a PR's green status is whatever its author says it was. A PR opened by hand, or a branch changed after its gate ran, reaches Chris unchecked. Branch protection on `main` requires a PR, but no status check. The harness's own tests (`.claude/hooks/test_hooks.py`, `factory/tests/run_test.py`) run only when someone remembers to, although the changelog promises CI runs them. And the 2026-11-22 U+FFFD bug showed that a check can pass silently for days when only one machine runs it.

## Outcome

Every PR to `main` gets these checks from GitHub Actions, with no human or agent starting them:

- **Build, lint and test:** the same gate as local (`factory/checks.sh`, Postgres included). It is a required check, so a red PR can't be merged.
- **Harness tests:** when `.claude/**`, `factory/**` or `adws/**` change.
- **Mock evals:** when `CLAUDE.md`, `.claude/**` or the LLM prompt files change. Against the mock, required to pass.
- **AI review:** one advisory PR comment from Claude, following `REVIEW.md`.

Chris can still measure real suggestion quality by starting a real-model eval run by hand. The docs say plainly what branch protection enforces and what it can't.

## Users and roles

- **Chris:** the only person who merges; he reads the checks and the AI review before merging. He adds the `ANTHROPIC_API_KEY` secret himself.
- **The drivers (L1, factory, ADWs):** their PRs get the same checks as Chris's own. Nothing in the drivers changes.
- **Tenants and app roles:** not affected; no app behaviour changes.

## Constraints

- **Decided (Chris):**
  - **AI review:** on every PR from a branch in this repo, using an `ANTHROPIC_API_KEY` Actions secret. Posts one comment with Important and Nit findings by `REVIEW.md`, is advisory (never a required check), and is capped (max turns) to keep the cost per PR small.
  - **Evals:** on matching PRs they run against the `MockProvider` (free, 15/15 today) and must pass. A separate manual workflow (`workflow_dispatch`) runs them against the real model only when Chris starts it; it reports the pass rate and never blocks a merge. No automatic run ever calls the real model.
  - **Branch protection:** the CI checks (gate, harness tests and mock evals when they run) become required on `main`. Required approvals stay at 0: every PR is opened under Chris's GitHub account, and GitHub never lets a PR's author approve it. The docs explain why: Chris is the human gate because he alone merges, and `guard.py` stops agents from approving or merging (D9).
- **From the repo:**
  - **Public repo:** PRs from forks get no secrets and must never run with them. No `pull_request_target` that checks out PR code.
  - **The same gate:** CI runs `factory/checks.sh` itself, not a copy of its steps, so local and CI can't drift.
  - **Library versions:** every action's version is checked when the plan is written, not remembered (CLAUDE.md, "Things Claude gets wrong").
  - **pnpm only.** Python harness tests run with stdlib `python3`, as locally.
  - **No secrets in logs,** and `.env` stays out of CI.

## Out of scope

- Deploying anything, preview environments.
- Changing the factory, the ADWs or the review agents themselves (CI runs alongside them, it doesn't replace them).
- Running the real model automatically on any PR, or the skill-trigger checks that call `claude -p`.
- Required reviewer approvals, CODEOWNERS, signed commits.
- Caching beyond what the setup actions offer out of the box.

## Open questions

- **Required checks when they don't run:** a check that runs only on some paths (harness tests, mock evals) can't simply be required, or PRs that skip it wait forever. The planner picks how (always-running job that exits early, or one summary job that is required).
- **Real-model eval results:** where the manual run's pass rate lands (job summary, artifact) and whether to record it in the docs.
- **AI review on an updated PR:** a new comment per push, or one comment edited in place.
