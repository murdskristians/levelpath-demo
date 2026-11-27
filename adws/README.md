# ADWs: the headless driver (L3)

AI Developer Workflows from my TAC harness (`git-adw`), pointed at this repo.
They run the same roles, gate and guards as `/factory run`, but from Python,
with no Claude Code session open: you comment `adw` on an issue, and a PR
comes back for you to review and merge.

```
uv run adws/adw_sdlc_iso.py <issue>      the whole run
  plan    intake → route → worktree trees/<adw_id> → scout (high risk) → planner
  rounds  builder → gate (factory/checks.sh) → reviewers in parallel
          any CHANGES → next round (max 3)
  end     approver: READY or ESCALATE → PR ready, label factory:needs-human → you merge
```

## Scripts

| Script | What it does |
| --- | --- |
| `adw_sdlc_iso.py <issue> [adw_id]` | Plan, then rounds until every reviewer passes or the rounds run out, then the approver. |
| `adw_plan_iso.py <issue> [adw_id]` | Intake, routing, worktree, scout, planner. |
| `adw_build_iso.py <issue> <adw_id>` | One builder round. |
| `adw_test_iso.py <issue> <adw_id>` | The gate on the current round; exit 0 PASS, 1 FAIL. |
| `adw_review_iso.py <issue> <adw_id>` | The routed reviewers; all PASS → approver and hand-over. |
| `adw_patch_iso.py <issue> <adw_id> "<feedback>"` | Your feedback on a waiting run → more rounds. |
| `adw_cleanup_iso.py <issue> <adw_id>` | After you merged or closed the PR: removes the worktree (long paths too) and the local branch, and records the run as merged or closed. |
| `adw_triggers/trigger_cron.py` | Opt-in poller: your `adw` or `adw patch` comments start runs. |
| `adw_tests/health_check.py` | Checks git, `gh`, and one tiny `claude -p` call (haiku, capped at $0.05). |

## How a step works

Each step is one role from `.claude/agents/`, run as
`claude -p --agent <role> --max-turns N --max-budget-usd X` from the main
checkout (`adw_modules/agent.py`). The prompt is the shared header:

```
Job: adw-<id>. Job folder: <repo>/agents/<id>/. Main checkout: <repo>. Worktree: <repo>/trees/<id>. Branch: adw/<id>-<slug>. Base: origin/main. Issue: #<n>.
```

The role writes a fixed file in `agents/<id>/`, and the pipeline reads its
first line (`adw_modules/pipeline.py`):

| File | First line |
| --- | --- |
| `intake.md` | `DECISION: ACCEPT \| NEEDS-INFO \| REJECT` |
| `spec.md`, `plan.md` | a title |
| `build.md` | `STATUS: READY \| BLOCKED` |
| `round-N/checks.md` | `GATE: PASS \| FAIL` |
| `round-N/review-<r>.md` | `VERDICT: PASS \| CHANGES` |
| `decision.md` | `READY \| ESCALATE` |

Routing (which reviewers, which models) comes from `factory/config.json`,
the same tables the factory uses (`adw_modules/roles.py`). Each step's
cost is recorded in `agents/<id>/adw_state.json` and summed in the final PR
comment.

## Setup

- Postgres up (`pnpm db:up`): the gate's API tests create their own database on
  it, and fail with "Run `pnpm db:up` first" without it.
- `gh auth login`, and `claude` logged in to your subscription. No
  `ANTHROPIC_API_KEY` is needed or passed on, unless you set
  `ADW_USE_API_KEY=true`.
- Screenshots in the PR comment need nothing extra: `factory/bin/shots`
  (shared with the factory) uploads them to your public
  `<you>/adw-screenshots` through `gh`, and only for a public repository.
- Optional, in `.env` (see `.env.sample`): `GITHUB_PAT`, if you want the ADWs'
  `gh` calls to use a token instead of `gh auth login`;
  `AGENT_BROWSER_EXECUTABLE_PATH` for the verifier's browser.
- Windows with Avast: run `uv` with `UV_NATIVE_TLS=1` the first time, so it can
  download the scripts' dependencies.

## What changed from git-adw

See `docs/HARNESS_CHANGELOG.md`. In short:

- **Roles, not prompts:** phases run the shared roles through file
  contracts. 682 lines of prose parsing (`workflow_ops.py`) are gone, and with
  them the "Plan file does not exist" failures.
- **Same gate as the factory:** the test phase is the exit code of
  `factory/checks.sh`.
- **No merge anywhere:** no ship or zte phases, and `approve_pr`/`merge_pr`
  are removed.
- **Capped and opt-in:** every agent has turn and budget caps. The trigger
  answers only your own comments.
