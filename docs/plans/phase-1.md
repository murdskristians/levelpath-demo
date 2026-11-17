# Plan: Phase 1, bring in and combine my harnesses

Status: **APPROVED 2026-11-17 (revision 2).** Revision 1 imported `git-adw` alone; it is replaced by this plan. The decisions are D1-D11 in [phase-1-audit.md](phase-1-audit.md); D8-D11 are in revision 2.

## Goal

One harness built from my three: `git-adw` (TAC ADWs), `tac-combined` (orchestrator, scouts, meta-skills) and my Windows fork of the software factory v2. It is pointed at NestJS + Postgres RLS + React and improved where each one fell short. Every adaptation is logged in `docs/HARNESS_CHANGELOG.md` as before → after → why.

## Design: one set of parts, three drivers

```
 drivers (who orchestrates)              same roles, same files, same gate
 L1 pair        you + /intent /spec /plan /verify /review
 L2 supervised  /factory run    (skill in your session, dashboard)        ← factory engine
 L3 unattended  adws/ headless  (`adw` comment by you, claude -p --agent)  ← git-adw engine
 ─────────────────────────────────────────────────────────────────────────────
 roles      intake · scout · planner · builder · verifier ·
            reviewer-bugs · reviewer-security · reviewer-spec · approver   (.claude/agents)
 knowledge  CLAUDE.md · skills · REVIEW.md · docs/templates
 gate       factory/checks.sh  (pnpm install · build · lint · test, plus the RLS suite in Phase 2)
 guards     .claude/hooks/guard.py (blocks) · format_on_edit.py
 end        PR + decision.md + label needs-human → Chris merges
```

- **One definition per role.** The factory spawns a role as a subagent. An ADW phase runs it headless with `claude -p --agent <role>`. An interactive command spawns it in the session.
- **One file contract.** Every role reads the same prompt header (job id, job folder, worktree, branch, round, port) and writes a fixed file that starts with `KEY: value` lines.
- **Separate state.**
  - Factory: `factory/jobs/<id>`, `.worktrees/`, ports from 5100.
  - ADW: `agents/<adw_id>`, `trees/`, ports from 9100/9200.
- **Nobody but Chris merges (D9).** The merge rule is enforced in four layers:
  - no merge code in any driver;
  - the guard hook (it blocks even under `--dangerously-skip-permissions`, as the spike proved);
  - a `settings.json` deny rule;
  - branch protection.

## Checkpoints

I stop and wait at three points so you can commit.

- **Stop A** after Step 2: the unmodified import (the "before").
- **Stop B** after Step 3: the adapted harness.
- **Stop C** after Step 5: gaps filled, GitHub repo, evidence. Phase 1 done.

## Step 0 (outside this repo): human-only merge in the factory

**Done 2026-11-17**, waiting for your commit.

- **Fork:** `job merge` and the `merging` stage are removed. The approver writes READY or ESCALATE, and both go to `needs-human`. The gate's `--merge` mode is removed. INSTALL adds a `Bash(gh pr merge:*)` deny rule.
- **Test:** `factory/tests/run_test.py` passes 34/34, including the no-merge checks.
- **MyPersonalWebsite:** synced, and its local settings deny `gh pr merge`.

## Step 1: Spike and docs

**Done 2026-11-17.**

- **Spike:** 4 tiny calls, $0.0044. Results are in audit [R2.6](phase-1-audit.md#r26-spike-evidence-2026-11-17-claude-code-21312).
- **Consequence:** frontmatter Stop hooks don't fire under `--agent`, so ADW runs the gate explicitly after the builder.

## Step 2: Import as-is → Stop A

**Done 2026-11-17**: commit `bc3b798` (76 files from the three sources, unmodified).

Copied unmodified, each source pinned to a commit:

- **Fork, at the Step 0 commit:** `.claude/skills/factory/`, the 8 factory agents, and `factory/` (bin, `config.json`, `checks.sh`, `dashboard.html`, `.gitattributes`, `tests/`).
- **`git-adw@6f7049e`:**
  - `adws/` modules, plus `adw_{plan,build,test,review,patch,sdlc}_iso.py`, `adw_triggers/trigger_cron.py` and `adw_tests/health_check.py`;
  - the commands used as role sources: `feature`, `bug`, `chore`, `classify_issue`, `implement`, `test`, `resolve_failed_test`, `review`, `patch`, `in_loop_review`;
  - `.claude/hooks/*`, `.claude/settings.json`, `CLAUDE.md` and `pyproject.toml`.
  - Any dropped file that a kept script imports comes along, and I note it.
- **`tac-combined@f739cbb`:** `scout-report-suggest`, `review-agent`, `playwright-validator`, `meta-agent` and `skills/meta-prompt/`.
- **Housekeeping:**
  - anchored `.gitignore` entries: `/factory/jobs/`, `/.worktrees/`, `/trees/`, `/agents/`, `/logs/`, `.claude/settings.local.json`, `__pycache__/`, `.venv/`, `.ports.env`;
  - ESLint and Prettier ignore `.claude/**`, `factory/**`, `adws/**`, `.worktrees/**` and `trees/**`;
  - build, lint and test still pass.

## Step 3: Adapt → Stop B (one changelog entry each)

**Done 2026-11-17**, waiting for your commit. Deviation: `REVIEW.md` and `docs/templates/` were pulled forward from Step 4 because the roles reference them. Every item has an entry in `docs/HARNESS_CHANGELOG.md`.

**Shared core**

- **C1 `guard.py`:** one blocking PreToolUse process; each block prints its reason. It blocks:
  - `.env` reads in bash, PowerShell and cmd forms, plus bare `printenv`/`env`/`set`;
  - `rm -rf`;
  - merges and pushes to `main`;
  - edits to migrations already in `HEAD`;
  - in a bug task, edits to tests that exist in the base (new regression tests are allowed);
  - protected paths inside worktrees.
- **C2 `format_on_edit.py`:** Prettier and ESLint on the edited file only. The other git-adw hooks are removed.
- **C3 `settings.json`:**
  - allow `pnpm`, `docker compose`, `uv run`, read-only git, and `gh issue`/`pr` read and comment;
  - deny `.env`, `rm -rf`, force-push and `gh pr merge`.
- **C4 Roles** (sonnet by default; findings Important/Nit):

  | Role                | Built from                                           |
  | ------------------- | ---------------------------------------------------- |
  | `intake`            | factory intake + classify_issue                      |
  | `scout`             | tac scout                                            |
  | `planner`           | spec-writer + feature/bug/chore + the Phase 0 lesson |
  | `builder`           | factory builder + implement/resolve_failed_test      |
  | `verifier`          | test + playwright-validator + the UX browser method  |
  | `reviewer-bugs`     | reviewer-code + tac review-agent                     |
  | `reviewer-security` | tenant isolation, auth, PII, prompt injection        |
  | `reviewer-spec`     | git-adw review.md                                    |
  | `approver`          | Step 0 version                                       |

- **C5 `checks.sh` and `config.json`:**
  - base `main`; concurrency 2; 3 rounds;
  - surfaces `api`/`ui`/`db`/`llm`/`security`;
  - `verifier`, `reviewer-bugs` and `reviewer-spec` always run; `db`, `llm` and `security` add `reviewer-security`;
  - opus only on high risk;
  - protected: `checks.sh`, `config.json`, `REVIEW.md`, `.claude/hooks/**`, `.claude/settings.json`.
- **C6 `CLAUDE.md`** (one page): commands with healthy output, conventions, architecture, "Verifying your work", the drivers, the tac rules, and "Things Claude gets wrong".

**Factory (L2)**

- **F1 Skill:** role names; verifier in every round; scout on high risk; routed models; spec and plan committed under `docs/`.
- **F2 `route`:** also returns the planner and builder models.
- **F3 `gate --hook`:** reads `agent_transcript_path` or `transcript_path`, and finds the worktree from the prompt header.
- **F4 Dashboard:** role names.

**ADW (L3)**

- **W1** Port the fixes proven on MyPersonalWebsite issue #13. Each entry cites the failure it fixed.
- **W2 `agent.py`:** `--agent <role>`, `--max-turns`, `--max-budget-usd`, and the collected `total_cost_usd`.
- **W3 Phases run the shared roles** with `agents/<adw_id>/` as the job folder.
  - Test is the gate's exit code; on failure, a builder round.
  - Reviewers are routed and run in parallel; CHANGES → a builder round, up to `max_rounds`.
  - Then the approver, a final `[ADW-BOT]` comment with verdicts, screenshots and cost, and `needs-human`.
- **W4 Trigger:** opt-in, the owner's `adw` comments only, interval ≥ 60 s.

**Interactive (L1)**

- **I1 Commands:** `/intent`, `/spec`, `/plan` (writes `.claude/task-type`), `/verify`, `/review` (parallel reviewers, REVIEW.md, nit cap), and `/try <pr>`.

## Step 4: Fill the gaps

**Done 2026-11-17**: the 4 skills, `docs/HARNESS.md`, `LICENSE` (GPLv3), `CREDITS.md`, and 9 `docs/LEARNING.md` entries. `REVIEW.md` and the templates came with Step 3.

- **Skills:** `nestjs-endpoint`, `rls-data-access`, `llm-call`, and `feature-workflow` (the three drivers).
- **Review and templates:** `REVIEW.md` and `docs/templates/{intent,spec,plan}.md`.
- **`docs/HARNESS.md`:** diagram, provenance table, when to use each driver.
- **Licensing:** `LICENSE` (GPLv3) and `CREDITS.md`.
- **Learning log:** `docs/LEARNING.md` entries.

## Step 5: GitHub and evidence → Stop C

**Done 2026-11-17.** L2 (issue #2 → PR #4) and L3 (issue #1 → PR #3) both ended READY in one round. The public repo `murdskristians/levelpath-demo` has the labels and branch protection on `main`. Evidence (hooks 81/81, factory scripts 35/35, skills 4/4, the live merge block, the L3 run → PR #3) is in `docs/HARNESS_CHANGELOG.md`, 2026-11-17.

1. **Before the first public push**, you decide whether `KICKOFF.md` stays public. Then:
   - `gh repo create murdskristians/levelpath-demo --public` and push;
   - labels;
   - branch protection on `main`.
2. **`uv run .claude/hooks/test_hooks.py`:** every guard case.
3. **`factory/tests/run_test.py`** passes.
4. **Trigger checks:** about 7 calls with `claude -p --max-turns 3`, one per skill and per reviewer.
5. **Two real runs on tiny issues:** L2 via `/factory run`, L3 via `uv run adws/adw_sdlc_iso.py <n>`. Both end at `needs-human`, and nothing gets merged.
6. **Negative test:** `gh pr merge` is blocked, with its reason.
7. `pnpm build`, `pnpm lint` and `pnpm test` exit 0.

## Cost

- **Spike:** $0.0044.
- **Trigger checks:** about 7 small calls.
- **Real runs:** about $2-5 API-equivalent each, on the subscription.
- Nothing runs on a schedule. I do not commit or push; you do, at the stops.

## Done when

- My harness runs in this repo through all three drivers.
- The changelog shows every adaptation as before → after → why.
- You can explain each file.
- Every hook and skill has pasted evidence of firing.
