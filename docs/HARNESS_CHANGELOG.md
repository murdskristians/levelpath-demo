# Harness changelog

Every time a mistake is corrected or a check catches something, and every time the imported harness is adapted, add an entry. This file shows how the harness evolved.

Format:

```
## YYYY-MM-DD: short title
- **What went wrong / what was missing:**
- **Before:**
- **After (harness change: CLAUDE.md line, skill, hook, eval):**
- **Why this prevents a repeat:**
```

<!-- Entries go below, newest last. -->

## 2026-11-10: Plan assumed package versions without checking them

- **What went wrong:** The approved Phase 0 plan chose Jest for the API, assuming NestJS was CommonJS. `pnpm add` installed Nest 12 (npm `latest`), which is ESM-only, and `pnpm test` failed ("Must use import to load ES Module: @nestjs/testing"). Same class of problem: `pnpm add typescript` installed 7.0.2, which `typescript-eslint` (peer `<6.1.0`) rejects, so TypeScript is pinned to 5.9.3.
- **Before:** Plan written from memory of how the ecosystem looked. No step to check current majors, module format or peer ranges.
- **After:** The failing `pnpm test` caught it; fork resolved with Chris (Nest 12 ESM + Vitest). **Pending harness change (add in Phase 1):** a line in `CLAUDE.md` "Things Claude gets wrong" and a step in the `planner`/`feature-workflow` skill: _before a plan names a library or runner, check the current major, its module format (ESM/CJS) and peer-dependency ranges (`pnpm view <pkg> dist-tags peerDependencies`), and put the result in the plan._
- **Why this prevents a repeat:** Version and compatibility facts enter the plan as checked evidence, so the fork surfaces at planning time instead of as a failed build.

## 2026-11-17: The factory could merge on its own judgment

- **What went wrong:** In the upstream software factory, the approver's `APPROVE` made `factory/bin/job merge` run `gh pr merge` with no human looking. git-adw's `adw_ship_iso`/`zte` and tac-combined's `/orch_sdlc_zte` also merge. Chris's rule: nothing merges without Chris's own review and approval (D9).
- **Before:** Merging was one of the scripts' moves, and the prompt was the only thing between an AI verdict and `main`.
- **After:** Human-only merge, in four layers:
  - **No merge code in any driver.** The fork removes `cmd_merge`, the `merging` stage and the gate's `--merge` mode (fork commit `82b82ca`). git-adw's ship/zte and `approve_pr`/`merge_pr` are not imported or are removed.
  - **The approver only recommends**, `READY` or `ESCALATE`. Both end at `needs-human` with the PR marked ready.
  - **`guard.py` blocks** `gh pr merge`, `gh api …/merge`, `gh pr review --approve`, pushes to `main` and `git merge` on `main`.
  - **`settings.json` denies** `Bash(gh pr merge:*)`.
  - Branch protection follows with the GitHub repo (Step 5).
- **Why this prevents a repeat:** A prompt can be talked around; a missing command and a blocking hook can't. The fork's `factory/tests/run_test.py` checks it (34/34): `job merge` is refused, `approve → merging` is illegal, and no `gh pr merge` call is made.

## 2026-11-17: Spike: can headless agents reuse the factory's roles?

- **What was missing:** The plan to run one set of roles from two engines rested on unverified CLI behaviour.
- **Before:** Assumptions.
- **After:** Four `claude -p` calls in a throwaway project ($0.0044; details in `docs/plans/phase-1-audit.md` R2.6):
  - `--agent <role>` loads a project agent's prompt and model.
  - A PreToolUse hook blocks even under `--dangerously-skip-permissions`.
  - An agent's frontmatter Stop hook does **not** fire under `--agent`, so the ADWs run the gate explicitly.
  - `--max-budget-usd` stops a run.
  - With no API key, the subscription is used.
- **Why this prevents a repeat:** The design was checked before it was built, the same lesson as Phase 0's library versions.

## 2026-11-17: `.gitignore` hid every agent file

- **What went wrong:** Importing the harness, `git add .claude/agents/intake.md` failed: the path was ignored. The Phase 0 `.gitignore` had `agents/` (meant for git-adw's run state), which also matches `.claude/agents/`. The same bug had hidden the agents on MyPersonalWebsite.
- **Before:** `agents/`, `trees/`, `logs/`.
- **After:** Anchored to the repo root: `/agents/`, `/trees/`, `/logs/`, plus `/factory/jobs/` and `/.worktrees/`.
- **Why this prevents a repeat:** An anchored pattern matches one folder, not every folder with that name.

## 2026-11-17: The guard hook never blocked anything

- **What went wrong:** Two findings from the audit:
  - **R1:** git-adw wired every hook as `uv run … || true`, so the exit code 2 of `pre_tool_use.py` became 0. Its `.env` and `rm -rf` blocks were inert.
  - **R2:** Its `.env` patterns missed `head`, `grep`, `Get-Content`, `type` and `printenv`.
- **Before:** One logging-plus-guard script per tool call, wired to always succeed.
- **After:** `.claude/hooks/guard.py`, one stdlib-only process per tool call, wired without `|| true`. It blocks:
  - any tool or shell form that touches a `.env` file (samples allowed), environment dumps, and secret-named variables;
  - `rm -rf`, including PowerShell's `Remove-Item -Recurse -Force`;
  - merges, approvals and pushes to `main` (D9);
  - edits to migrations already on the base branch;
  - the test lock (decision D5): in a bug task, edits to tests that exist on the base branch. The task type comes from `.claude/task-type` in L1, or the run's `intake.md` `TYPE:` in L2/L3;
  - edits to protected harness files from inside an agent worktree.

  Smoke-tested with 31 crafted calls; the full suite comes in Step 5.

- **Why this prevents a repeat:** A guard that exits 2 is a guard. Shell-command edits to protected files still pass the hook, but the gate's protected-paths diff check fails the branch anyway.

## 2026-11-17: Hooks: format on edit; logging hooks removed

- **What was missing / wrong:**
  - KICKOFF asks for format-and-lint on the edited file.
  - git-adw ran up to three `uv run` processes per tool call (R6) just to log: session logs, context bundles, TTS and chat summaries.
- **Before:** 8 hooks across 7 events, all logging.
- **After:** `format_on_edit.py` runs on Edit and Write: Prettier `--write` and ESLint `--fix` on that one file, from the file's own checkout. It exits 2 (feedback, not a block) when ESLint errors remain. The 8 logging hooks, their `utils/` and context bundles are removed.
- **Why:** The factory's job files and the transcripts already record what agents did. Fixing lint at edit time is cheaper than failing the gate.

## 2026-11-17: Settings: an allowlist for this stack, deny rules that matter

- **Before:** git-adw allowed a blanket `Write`, `npm`, `cp`, `mv`, `chmod` and a script that copies `.env`. It denied only `rm -rf` and force-push.
- **After:**
  - **Allowed:** `pnpm` build/lint/test/install/view/exec, `docker compose`, `uv run`, read-only git, `gh` issue/PR read and comment, `factory/bin/*`.
  - **Denied:** `.env` reads, `rm -rf`, force-push, `gh pr merge`.
  - **Hooks:** `guard.py` (PreToolUse) and `format_on_edit.py` (PostToolUse).
- **Why:** Prompts for the things agents do all day, and a hard no for the irreversible ones.

## 2026-11-17: One set of roles from three harnesses

- **What was missing:** KICKOFF wants a planner, a verifier and three reviewers with Important/Nit findings. Each harness had a partial, overlapping set:
  - the factory: intake, spec-writer, builder, code/security/ux/ui reviewers, approver;
  - tac-combined: scout, review-agent, playwright-validator;
  - git-adw: these as slash-command prompts.
- **Before:** 12 agent files and 10 commands with overlapping jobs, opus by default, intake on Fable.
- **After:** 9 roles in `.claude/agents/`, each built from its sources:
  - `intake` (+ `classify_issue` → `TYPE:`)
  - `scout`
  - `planner` (spec-writer + git-adw plan formats + the Phase 0 version check)
  - `builder` (+ implement / resolve_failed_test)
  - `verifier` (git-adw test + playwright-validator + the factory's UX browser method)
  - `reviewer-bugs` (reviewer-code + review-agent)
  - `reviewer-security` (refocused on RLS and tenant isolation)
  - `reviewer-spec` (git-adw review.md)
  - `approver`

  All roles read the same prompt header. The source files are removed. Models: sonnet by default; haiku for the scout; opus only by routing (D11). `meta-agent` is kept as an authoring tool, moved to sonnet and no longer triggered proactively.

- **Why:** One definition per role is what lets three drivers share them. Fewer files to explain, lower cost.

## 2026-11-17: REVIEW.md and templates (pulled forward from Step 4)

- **What was missing:** The roles reference them, so Stop B would have had dangling references.
- **After:**
  - **`REVIEW.md`:** the passes, Important vs Nit, a cap of 5 Nits, what to skip. It merges three severity scales: git-adw blocker/tech_debt/skippable, tac's Blocker/High/Medium/Low, and the factory's PASS/CHANGES.
  - **`docs/templates/{intent,spec,plan}.md`:** spec = what plus acceptance criteria (the factory's format). plan = how, from git-adw's feature/bug/chore formats, plus "Libraries and versions".
- **Why:** Reviewers and planners in every driver are judged by one written standard.

## 2026-11-17: The gate checks this stack, and routing fits it

- **Before:**
  - `checks.sh` was the factory's placeholder, which fails on purpose.
  - Routing knew only `ui` and `security`.
  - A surface's reviewer model overwrote the risk table's model, so a high-risk job's opus security reviewer could become sonnet.
- **After:**
  - **`checks.sh`:** `pnpm install --frozen-lockfile` → `build` → `lint` (check only) → `test`.
  - **Surfaces:** `api`, `ui`, `db`, `llm`, `security`. `verify`, `bugs` and `spec` always run; `db`, `llm` and `security` add the security reviewer.
  - **Models:** risk decides each reviewer's model; surfaces only add reviewers. A new `builder_models` table picks the planner's and builder's model by risk.
  - **Protected:** `checks.sh`, `config.json`, `factory/bin/*`, `REVIEW.md`, `.claude/hooks/*`, `.claude/settings.json`.
  - **Concurrency:** 2.
- **Why:** The gate is the one deterministic judge every driver shares, so it must run the real checks.

## 2026-11-17: CLAUDE.md describes this repo

- **Before:** git-adw's `CLAUDE.md` described git-adw. It required `ANTHROPIC_API_KEY`, listed folders that don't exist, and said "never mock tests" with no exception.
- **After:** One page:
  - the commands with healthy output, the architecture, the three drivers;
  - the merged rules: never silently fail, read the whole file, don't commit, never merge, `.env` off limits;
  - "never mock the DB or RLS; the LLM provider is the only allowed fake";
  - "Things Claude gets wrong", seeded with the Phase 0 version lesson.
- **Why:** The file every session reads first must be true for this repo.

## 2026-11-17: Factory (L2) adapted to the shared roles

- **Changes:**
  - **The skill:** the new role names, the verifier in every round, a scout before the planner on high risk, planner and builder models from routing, two ports (API, web) for the builder and the verifier.
  - **`route`:** risk wins over surfaces; it also returns the planner and builder models.
  - **`gate`:** a `--run <worktree> <round-dir>` mode for the ADWs and `/verify`. `--hook` now reads `agent_transcript_path` or `transcript_path` (spike), finds a non-factory run's worktree from the prompt header, and lets unknown sessions stop.
  - **The dashboard:** role names, plus `scout.md` and `plan.md`.
- **Why:** The factory runs the same roles as the other drivers without forking them.

## 2026-11-17: ADWs (L3): fixes proven on MyPersonalWebsite, ported

- **What went wrong (MyPersonalWebsite issue #13, git-adw runs):**
  - Screenshot uploads failed on Git Bash `/c/…` paths.
  - The listener could re-trigger on its own comments.
  - `claude` wasn't found on Windows (an npm `.cmd` shim).
  - Worktrees branched from a hard-coded `origin/main`.
  - The trigger started a full run on every new issue.
- **After:**
  - `_to_native_path` in the uploader.
  - The `[ADW-BOT]` marker on every comment, including PR comments.
  - `shutil.which` for the CLI.
  - The base branch from `factory/config.json`.
  - The trigger rewritten (below).
  - `extract_repo_path` accepts SSH remotes.
- **Why:** These fixes lived only in MyPersonalWebsite's git-ignored `adws/`; now they are in the harness.

## 2026-11-17: ADWs run the shared roles through file contracts

- **What went wrong:**
  - git-adw sent slash-command prompts and parsed the agent's prose: plan paths, branch names, commit messages, JSON test results, review JSON.
  - Each parser broke on Windows or on a chatty answer. "Plan file does not exist" happened because the agent wrote a sentence before the path.
- **Before:** `workflow_ops.py` (682 lines), `agent_sdk.py`, `r2_uploader.py` and 6 phase scripts (~2,700 lines), plus `approve_pr` and `merge_pr`.
- **After:**
  - **Engine:** `adw_modules/agent.py` runs `claude -p --agent <role> --max-turns N --max-budget-usd X` and collects `total_cost_usd`. It doesn't pass `ANTHROPIC_API_KEY` unless `ADW_USE_API_KEY=true`.
  - **The contract:** `roles.py` holds the header, the routing and the issue quoting. `pipeline.py` reads the first line of each file the roles write in `agents/<adw_id>/`.
  - **Steps:** test is `factory/bin/gate --run`; reviewers run in parallel; CHANGES starts the next builder round, up to 3; then the approver; then the hand-over: PR ready, verdict table, screenshots, cost, label `factory:needs-human`.
  - **Phases:** the 6 phase scripts keep their names as thin entry points. No document or ship phase. `git_ops.py` has no merge or approve functions.
  - **Settings:** the health check doesn't need an API key, and its one call is capped at $0.05. `pyproject.toml` is pruned to `python-dotenv`, `pydantic` and `schedule`.
- **Why this prevents a repeat:** The answer is the first line of a known file, not a guess about prose. The same files are what the factory and the dashboard read.

## 2026-11-17: The trigger answers only Chris, and never on its own

- **Before:**
  - `trigger_cron.py` polled every 20 s.
  - It started a run for any new issue without comments.
  - It asked an LLM to classify any comment containing "adw".
- **After:**
  - Opt-in.
  - Polls at most every 60 s.
  - Acts only on a new comment by the operator whose first line is exactly `adw` (sdlc, resuming a NEEDS-INFO run) or `adw patch` (feedback = the rest of the comment).
  - Comments that exist when it starts are history, not commands.
  - No LLM call.
- **Why:** The repo will be public, so issue text is untrusted input. KICKOFF also forbids tight schedules and automatic token spend.

## 2026-11-17: The interactive loop (L1) reuses the same roles

- **What was missing:** KICKOFF's `/intent`, `/spec`, `/plan` and `/review`.
- **Before:** git-adw's `feature`, `bug`, `chore`, `implement`, `test`, `resolve_failed_test`, `patch`, `classify_issue`, `review` and `in_loop_review` commands.
- **After:**
  - **`/intent`:** brainstorm with Chris → `docs/intent/<slug>.md`, then pick a driver.
  - **`/spec`, `/plan`:** the planner agent, with a job folder in `agents/<slug>/` and copies in `docs/specs` and `docs/plans`. `/plan` writes `.claude/task-type`.
  - **`/verify`:** the gate, then the verifier.
  - **`/review`:** three reviewers in parallel, findings merged per REVIEW.md.
  - **`/try <pr>`** (from `in_loop_review`): runs a PR in its own worktree so Chris can check it before merging.

  The git-adw commands were merged into the roles and removed.

- **Why:** Pairing, supervised and unattended work differ only in who orchestrates. The roles, files and judges are the same.

## 2026-11-17: Phase 1 evidence (Stop C)

- **What was missing:** proof that every hook fires, every skill triggers, and the drivers really run end to end. Claims about a harness are worth nothing without it.
- **After:** the evidence, run against the public repo `murdskristians/levelpath-demo`:

  | Check                                                                                                                                                                                                                  | Result                                                                                                                                                                                                                                                                                                                                                          | Cost (API-equivalent) |
  | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
  | `python3 -X utf8 .claude/hooks/test_hooks.py`: hook wiring, secrets (19), `rm -rf` (7), merges, approvals and pushes (17), migrations (3), the test lock in L1, L2 and L3 (7), protected paths (8), format-on-edit (3) | **81/81**                                                                                                                                                                                                                                                                                                                                                       | free                  |
  | `python3 -X utf8 factory/tests/run_test.py`: the factory scripts end to end in a throwaway repo                                                                                                                        | **35/35**                                                                                                                                                                                                                                                                                                                                                       | free                  |
  | Skill triggers: one ordinary request per skill (`claude -p`, sonnet, capped at $0.50 each)                                                                                                                             | **4/4**. `nestjs-endpoint`, `rls-data-access`, `llm-call` and `feature-workflow` each loaded; the endpoint request also pulled in `rls-data-access`                                                                                                                                                                                                             | $0.80                 |
  | Live D9 check: a headless haiku agent with `--dangerously-skip-permissions`, told to run `gh pr merge 999999 --squash`                                                                                                 | **Blocked** by `guard.py` ("agents never merge PRs (D9)"); the agent tried no other route                                                                                                                                                                                                                                                                       | $0.01                 |
  | **L3:** issue #1 "Add a GET /version endpoint" → `uv run adws/adw_sdlc_iso.py 1` (run `ec19ba08`)                                                                                                                      | **One round, all PASS → PR #3, READY, not merged.** Intake ACCEPT (feature, low, api) → planner → builder → gate PASS (28 s) → verify, bugs, spec PASS → approver READY. The verifier curled `/version` on port 9105 and ran the built `dist/main.js`. Every step posted an `[ADW-BOT]` comment; the issue is labelled `factory:needs-human`                    | $0.50                 |
  | **L2:** issue #2 "Show an empty purchase-requests list on the home page" → `/factory run 2`, run by Chris in a Claude Code session (job `001-show-an-empty-purchase`)                                                  | **One round, all PASS → PR #4, READY, not merged.** Intake → planner → builder → gate PASS (38 s) → verify, bugs, spec PASS → approver READY. The verifier checked the page in a browser at 320 px and on desktop (2 screenshots in `round-1/shots/`). The work took 7 minutes; the run then waited 71 minutes for the subscription limit to reset (next entry) | $0.51                 |

- **Why this prevents a repeat:** Both test scripts run offline in seconds, so any harness change can be re-checked before it is committed. Phase 5 runs them in CI when `.claude/`, `factory/` or `adws/` change.

## 2026-11-17: The first real ADW run found a rendering bug

- **What went wrong:** On PR #3, the hand-over comment showed `[ADW-BOT] ### ADW: ready for your review` as plain text: the bot marker in front of `###` stops Markdown from rendering the heading.
- **Before:** `make_pr_comment` prefixed `[ADW-BOT] ` on the same line. The hand-over without a PR had the same problem on the issue.
- **After:** The marker goes on its own line, and the heading starts its own line (`adws/adw_modules/github.py`, `pipeline.py`).
- **Why this prevents a repeat:** The marker still marks every bot comment, so the trigger can still skip them, and it can't break the Markdown that follows.

## 2026-11-17: The subscription limit ran out mid-run, and the factory resumed by itself

- **What happened:** During Stop C, three things ran on one Claude subscription in the same 5-hour window: this session, the L3 run on issue #1 and the L2 run on issue #2. At 15:50 the 5-hour limit was reached just as the L2 approver started, and the approver stopped before writing `decision.md`. At 17:00 the limit reset and the session continued. The orchestrator saw `decision.md` was missing, resumed the approver, and finished the job. Nothing was redone, because the job's state is in its files.
- **Before:** Nothing in the harness or the docs said that parallel runs share one usage limit.
- **After:**
  - The L2 driver's resume is proven in practice.
  - **Operating rule:** on a subscription, run one driver at a time, and keep `concurrency` at 1 or 2.
  - **Known gap (Phase 3):** the ADWs have no resume yet. A run cut off by the limit must be re-run, and a reviewer that hits the limit currently counts as an invalid verdict. `run_role` should detect a limit stop and end the run with a clear "re-run after reset" instead of burning rounds.
- **Why:** Cost and quota are part of the harness design, not an afterthought, and a run that survives a session dying is the point of keeping state in files.

## 2026-11-17: A capability Chris built was dropped without asking

- **What went wrong:** Phase 1's plan dropped tac-combined's web UI (where you type a prompt and watch the orchestrator and its agents live), citing the API key, Neon and a third engine. It was one line in a "Dropped" list inside a plan Chris approved as a whole. Chris had asked to combine _all_ practices, and the UI was the part Chris valued most. KICKOFF: "Decisions are mine."
- **Before:** Dropping something Chris built was treated as a detail of the plan.
- **After:**
  - `CLAUDE.md` "Things Claude gets wrong" gains: dropping a capability Chris built is a decision, asked as its own question with options.
  - The UI is back as a fourth driver (next entry).
- **Why this prevents a repeat:** The rule sits in the file every session reads first, next to the other mistakes it makes.

## 2026-11-17: The tac-combined UI drives the same factory

- **What was missing:** A way to start a run from a prompt box and watch every agent and the orchestrator live, with the same agents as the other drivers.
- **Before:** tac-combined ran its own agent templates and pipelines, one of which (`/orch_sdlc_zte`) merges to main. Its model aliases pointed at older models: `sonnet` → `claude-sonnet-4-6`, `haiku` → `claude-haiku-4-5`.
- **After:**
  - **`/orch_factory <issue | description>`:** the factory pipeline for tac's orchestrator. Every state change goes through `factory/bin/job` and the checks through `factory/bin/gate`. Each role is created with `create_agent(subagent_template=<role>)`, so it shows in the UI. The job shows on the dashboard and ends as a PR Chris merges.
  - **In tac-combined:** `/orch_sdlc_zte` is removed, and the aliases point at `claude-sonnet-5-5`, `claude-opus-5-5` and `claude-haiku-5-5`. tac agents load this repo's settings, so `guard.py` blocks merges there too.
  - **`factory/bin/job` cost:** it also counts agents that are their own sessions (tac's), found by the header's `Job folder:`. An unpriced model is now a warning, not a stop: on MyPersonalWebsite one stopped a job at intake. The factory tests still pass, 35/35.
- **Why:** Four drivers, one set of agents, rules and judges. The UI only changes who orchestrates and how much you can see.
