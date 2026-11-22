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

## 2026-11-17: Worktrees could not be removed on Windows ("Filename too long")

- **What went wrong:**
  - After PRs #3 and #4 were merged, `factory/bin/job queue` moved job 001 to `merged`, but deleting its worktree failed with `Filename too long`.
  - `git worktree remove` failed the same way for the ADW run.
  - pnpm's `node_modules` have paths over Windows' 260-character limit. Git let go of the worktrees but left their folders, which nothing could delete by hand.
- **Before:** `remove_worktree` printed "close whatever has files open" (the wrong diagnosis) and left the folder. The ADWs had no step after a merge at all.
- **After:**
  - **Long-path deletion:** `rmtree_long` in `factory/bin/job` and `adws/adw_modules/worktree_ops.py` deletes with the Windows long-path prefix (two backslashes, `?`, a backslash) and clears read-only flags. Tested on a 447-character tree.
  - **Cleanup:** both drivers then run `git worktree prune`. The new `adws/adw_cleanup_iso.py <issue> <adw_id>` closes out an ADW run after the merge: worktree, local branch and label, and the run is recorded as `merged`. Tested on run `ec19ba08`.
  - **Git:** this clone also has `core.longpaths=true`.
- **Why this prevents a repeat:** The cleanup no longer depends on git handling long paths, and each driver has a defined last step after a person merges.

## 2026-11-17: The control room: every run, live, in one local page

- **What was missing:**
  - Chris wanted tac-combined's live view (start from a prompt, watch the orchestrator and every agent) and the factory's board, over every run whichever driver started it.
  - levelpath-demo must stand alone.
  - tac-combined is private course code (about 25,000 lines), and this repo is public, so it couldn't simply be copied in. Chris chose our own UI.
- **Before:**
  - The dashboard showed only `/factory run` jobs.
  - Its documented `python3 -m http.server` would serve the whole repo, `.env` included, if run from the root, and listen on every network interface.
  - Agent activity was only in transcripts.
- **After:** `factory/bin/serve` (stdlib) and the extended `factory/dashboard.html`:
  - **Board:** factory jobs and ADW runs side by side. ADW state is shaped like a factory job, with a driver badge.
  - **Agents tab:** each agent's text, tool calls and results, live.
    - Factory subagents are found by the job header in Claude Code's transcripts, with the role, model and finished flag from their `.meta.json`.
    - ADW agents come from their stream logs.
    - The orchestrator's decisions come first.
  - **Prompt box:** files the issue and starts a detached ADW run.
  - **Feedback box:** for a waiting ADW run.
  - **Files tab:** now shows the verifier's screenshots.
  - **Safety:** localhost only, `Host` checked, only run folders served, and POSTs need a custom header.

  Verified against both real runs, with browser screenshots. The browser check caught one bug: the feedback box showed on merged runs.

- **Why:** Seeing what the agents actually do is how you learn to trust a factory, and how you show it in an interview. It reads the files every driver already writes, so the drivers didn't change.

## 2026-11-17: levelpath-demo stands on its own

- **What went wrong:** The orchestrator-UI driver lived in tac-combined, a separate, private project with its own settings. Chris wants this repo to need nothing from another project. A check of visibility also showed that `CREDITS.md` linked private repositories (git-adw, tac-combined, multi-agent-orchestration), so the public saw dead links.
- **Before:** `.claude/commands/orch_factory.md` lived in this repo, and three credits were links.
- **After:**
  - `/orch_factory` moved into tac-combined's own toolkit (tac-combined offers its toolkit to any repo it points at), so tac-combined can still drive this factory privately.
  - The control room replaces it here.
  - The credits name the private sources without linking them.
- **Why:** A public demo repo must run from a clone, with nothing hidden behind private links.

## 2026-11-17: Code from private repositories was published, then scrubbed

- **What went wrong:**
  - Phase 1 recommended a public GPLv3 repository and imported code from git-adw and tac-combined without checking where it came from. Both are **private**: course material (IndyDevDan's Tactical Agentic Coding and multi-agent orchestration).
  - Their code was public here for about five hours: in the unmodified import commit, and adapted in later commits. GitHub recorded 0 forks, 0 views and 0 clones.
  - Found while fixing `CREDITS.md` links that led nowhere.
- **Before:**
  - `adws/` kept six modules and a health check adapted from git-adw.
  - `.claude/` kept tac-combined's `meta-agent` and `meta-prompt` skill.
  - Every commit since the import carried the originals.
- **After:**
  - **Replaced:** new `adws/adw_modules` `gh`, `state`, `worktrees`, `shots`, `logs` and a new `health_check.py` replace the adapted ones. The two tac-combined tools are removed. `CREDITS.md` and `docs/HARNESS.md` say only ideas came over.
  - **History rewritten:**
    - Every file whose content matched a private original was removed from every commit, and so were the adapted files before the replacement commit.
    - 0 of 58 private blobs remain reachable, no private identifier remains, and the final tree is byte-identical.
    - Commit messages and Chris's own work keep their history.
  - **The repository** was copied first (a full mirror, plus every issue, PR, comment and review as JSON and Markdown, kept locally), then deleted and recreated. Recreating it was the only way to also drop GitHub's permanent PR references to the old commits.
  - **`CLAUDE.md`, "Things Claude gets wrong":** before code from another repository goes into this public one, check its visibility. From a private source, only ideas come over.
- **Evidence:** the rewritten ADW engine on the new repository's issue #1, "Add a page footer with the app name and the current year" (run `cf2c382c`):
  - **One round, all PASS:** intake ACCEPT (feature, low, ui) → planner → builder → gate PASS in 33 s → verify, bugs and spec PASS → approver READY.
  - **The result:** PR #2, ready, not merged. The hand-over comment now renders its heading.
  - **Visual check:** the verifier's screenshots at desktop and 320 px show the footer.
  - **Cost:** $0.52, API-equivalent.
- **Note:** issue and PR numbers in the entries above this one refer to the deleted repository. Its copy holds them.
- **Why this prevents a repeat:** The check sits in the file every session reads first. The ADW engine is now entirely this repository's own code, so nothing in it depends on a private source.

## 2026-11-17: Screenshots show inline in the PR

- **What went wrong:** PR #2's hand-over listed the verifier's screenshots as local paths (`C:\Users\...\agents\cf2c382c\round-1\shots\...`). The reviewer couldn't see them, and the comment published a path from Chris's machine. The cause was that the uploader only worked with a `GITHUB_PAT`, which `.env` doesn't have. The factory (L2) never attached screenshots at all.
- **Before:** `adws/adw_modules/shots.py` (ADW only) uploaded through the REST API with its own token, or fell back to local paths.
- **After:**
  - **One uploader for both drivers:** `factory/bin/shots`. It stores the images in your public `<you>/adw-screenshots` under `<project>/<run>/<file>` and the comment links the raw URLs, which GitHub renders inline.
  - **Through `gh api`:** it uses your `gh auth login` (or `GITHUB_PAT` when set), so it never reads or prints a token. The first version used Python's own HTTPS and crashed on this machine (`OPENSSL_Uplink`); `gh` handles TLS, as it does for everything else here.
  - **Only for a public repo:** if the project's repository is private, the images stay local, so they aren't published while the code is not.
  - **Never in the way:** with no login, no network or a non-GitHub origin it says why on stderr, and the comment lists file names relative to the repository, not machine paths.
  - **Wired in:** `job advance <id> needs-human` appends the section to the PR comment (L2); the ADW hand-over calls the same script (L3). `adw_modules/shots.py` is removed.
- **Evidence:**
  - `factory/tests/run_test.py`: 42 checks pass (7 new: hand-over lists a repo path, upload path and URL, private repo, logged-out `gh`, non-GitHub origin, usage).
  - A real upload of PR #2's two screenshots returned URLs that serve `200 OK`; the ADW's own `screenshots()` produced the same section from the real run.
- **Why:** A review comment should show what the verifier saw. Evidence you have to dig for is evidence nobody checks.

## 2026-11-18: A spec criterion no build could pass

- **What went wrong:** The planner's Phase 2 spec gave the app `INSERT` on `tenants` and required a test where the app inserts a tenant row and succeeds. Under the spec's own policy (`tenants` is keyed on `id`), company A may insert only the row whose id is A, and that row already exists. No correct build could pass the test, so the builder would have had to change it or escalate. The orchestrator caught it reading the spec before `/plan`.
- **Before:** the planner's checklist asked for numbered, observable criteria, but not for criteria that fit the requirements.
- **After:**
  - **The spec:** the app only reads `tenants` and `users` (Chris's decision: sign-up and user management are out of scope). Their insert, update and delete tests expect "permission denied", which is stronger than RLS alone.
  - **`planner.md`:** before finishing, read every criterion as the builder will, against the grants, policies, keys and defaults the spec sets.
- **Why:** In L2 and L3 nobody reads the spec before the builder does, so a contradiction costs a round or an escalation. The check belongs where the spec is written.

## 2026-11-18: Each test run gets its own database, and the gate needs Postgres

- **What changed:** Phase 2 brought the first tests that need a database. The `rls-data-access` skill had planned for `factory/checks.sh` to create a database per run, but the gate is a protected path: runs can't change it, and it can't start Postgres per worktree either, since a second Compose project would fight over port 5432.
- **Before:** the skill said `factory/checks.sh` creates `lp_<run>`. `pnpm test` needed nothing running.
- **After:**
  - **The tests make their own database:** Vitest's global setup creates `lp_<random>` on the one shared Postgres server, migrates and seeds it, and drops it at the end. Every driver gets this, and so does a plain `pnpm test`, and `checks.sh` is unchanged.
  - **The gate needs Postgres up:** without it, the API tests fail with "Run `pnpm db:up` first". They are never skipped, so a missing database can't pass as green. `CLAUDE.md`, the factory skill and the ADW README say to run `pnpm db:up` before a run.
- **Evidence:** two test runs started at the same moment both pass and leave no `lp_*` database behind (see the Phase 2 PR).
- **Why:** Parallel runs must not share rows, and a gate that quietly skips the database tests would pass exactly the changes they exist to catch.

## 2026-11-18: `/plan`'s task-type file was about to be committed

- **What went wrong:** `/plan` writes `.claude/task-type` (`feature`, `bug` or `chore`) for the guard's test lock. The file wasn't git-ignored, so Phase 2's first `git status` listed it as new, ready to be committed into the PR.
- **Before:** `.claude/task-type` was untracked and not ignored.
- **After:** `.gitignore` lists it next to `.claude/settings.local.json`: it is this checkout's state, not the repo's.
- **Why:** A committed task type would set the test lock for everyone who checks the branch out, and a `bug` left behind would block test edits in the next feature.

## 2026-11-18: Phase 2 review round 1: three defense-in-depth gaps

- **What the reviewers caught:** the round passed on isolation (bugs, security and the verifier: PASS), but `reviewer-bugs` and `reviewer-security` found three ways the setup could fail quietly or badly:
  - nothing outside the tests checked that the API's login is subject to RLS, so `APP_DB_USER` pointed at the owner would have started cleanly and served every tenant;
  - the pool had no `error` listener, so a Postgres restart would have crashed the API;
  - the app role could create temporary tables, which Postgres searches before `public`, so one named like a real table would shadow it on that pooled connection.
- **Before:** the rules were in the code and the tests, but a wrong environment could still switch them off without an error.
- **After:**
  - **Checked at runtime:** the API refuses to start on a login that is a superuser, has `BYPASSRLS` or owns tables. `pnpm db:migrate` refuses an existing `APP_DB_USER` with `SUPERUSER`, `BYPASSRLS`, `CREATEROLE` or `CREATEDB`.
  - **Resilient:** the pool logs a dropped idle connection instead of exiting.
  - **No temporary tables:** migration 0001 revokes `TEMPORARY` on the database from `PUBLIC`.
  - **Tests for each.** The new pool test fails without the listener (checked by removing it).
  - **`rls-data-access` skill:** the runtime check and two rules for Phase 3 writes (no user input in raw SQL; never accept a client-chosen id, and answer key violations as "not found").
- **Why:** Isolation that depends on configuration must check that configuration itself; a misconfiguration should stop the app, not quietly turn the policies off.

## 2026-11-18: Phase 2 review round 2: the checks learn about role memberships

- **What the reviewer caught:** round 2 passed, and `reviewer-security` probed past its own round-1 findings:
  - A login that is a **member** of the owner role passed both new checks. Superuser and `BYPASSRLS` aren't inherited, but `SET ROLE` to the owner is allowed, and ownership is inherited. A plausible path: `GRANT levelpath_owner TO levelpath_app` to clear a "permission denied". `REPLICATION` was missed too.
  - The startup check trusted the `TEMPORARY` revoke instead of checking it, and didn't check `CREATE` on the database (a schema named after the role would come before `public`).
  - The pool listener covered idle connections only. A connection that dies while a request holds it emits `error` on the client, and that still crashed the API.
  - Skill rules 5 and 6 didn't name Kysely's unsafe `sql.*` helpers or unique keys that leak across tenants.
- **Before:** the checks looked at the login's own attributes and at tables it owns in `public`.
- **After:**
  - **Both checks** refuse `REPLICATION` and membership in any role. The startup check also refuses ownership of any table or schema and the right to create schemas or temporary tables.
  - **Every client** gets an `error` listener. A test ends a connection in use and an idle one with `pg_terminate_backend`, and fails if either listener is removed (checked by removing each).
  - **Skill rules 5 and 6** name the unsafe helpers and require unique keys to start with `tenant_id`.
- **Why:** A check that reads only the obvious attributes can be walked around by the next-most-obvious misconfiguration. Asking the reviewer to look again after a fix found what the first fix missed.

## 2026-11-18: Phase 2 review round 3: an untyped argument picks the wrong function

- **What the reviewer caught:** round 3 passed, and `reviewer-security` went one level further.
  - **`resolveUser` sent its id untyped.** Postgres resolves an untyped argument to a `text` overload before the real `uuid` function. With `CREATE` on `public` (the usual fix for "permission denied for schema public"), SQL running as the app role could plant `app_resolve_user(text)` and decide every later caller's tenant. The reviewer proved it in a rolled-back probe; our own test reproduced it: without the cast, Alice resolved to Globex.
  - **`GRANT ALL` would add `TRUNCATE`,** which RLS doesn't cover, and the startup check didn't look at grants on objects.
  - **Three refusals had no test.**
- **Before:** `public.app_resolve_user(${userId})`; the startup check read `current_user` and the login's attributes, memberships, ownership and database rights.
- **After:**
  - **The cast:** `public.app_resolve_user(${userId}::uuid)`, with a test that plants the look-alike.
  - **Grants are checked too:** the startup check refuses `CREATE` in any schema and `TRUNCATE` on any table, reads `session_user`, and its hint says to fix the login or the database's grants.
  - **Every branch is tested:** the owner tests assert the whole list of problems.
  - **Skill rules 2 and 5:** fix a "permission denied" with a narrow grant, never `GRANT ALL`; cast arguments to functions in raw SQL.
- **Why:** The common fixes for a "permission denied" (`GRANT ALL`, `GRANT CREATE ON SCHEMA public`, a role membership) are exactly what would weaken isolation. The API should refuse to start, not quietly accept them.

## 2026-11-21: Phase 3 ran as two parallel factory jobs; what the end-to-end check found

- **What happened:** the contract (Zod schemas in `packages/shared`) merged first, then issues #5 (API) and #6 (web) ran as two factory jobs at the same time. Both passed in round 1 and both approvers escalated, as the rules say they must (roles, a new dependency, a harness skill edit). Cost: $5.56 and $1.78 API-equivalent. Chris merged #7 and #8. The end-to-end check on `main` (real UI and real API together, the first time they met) passed every step in the browser and 11 of 11 API edge cases. Building both sides from one contract left nothing to reconcile.
- **What no review caught:** four problems in the harness, none of them in the app. Each one is an entry below.

## 2026-11-21: The board kept showing merged jobs as "needs human"

- **What went wrong:** after Chris merged both PRs, the control room still showed them waiting for a human. A job moves to `merged` only inside `job queue`, and only the orchestrator runs that, at the start of its next pass. The orchestrator's session had ended, so nothing ran it.
- **Before:** merge detection lived only in `cmd_queue`.
- **After:**
  - **`job check-merges`:** merge detection on its own (`queue` calls it too). It reports on stderr, so `queue`'s rows on stdout stay as the orchestrator reads them.
  - **The control room** runs it every 60 s in a separate process. In-process it would hold every job's lock for the server's lifetime, because `job` releases a lock only when its process exits.
  - **`run_test.py`:** check-merges leaves a job with an open PR alone, and moves it once the PR is merged (43 passed).
  - **The name:** the first one, `job merged`, failed the existing test "usage lists no merge command". The command was renamed; the test was kept as it was.
- **Why:** the board must show what is true on GitHub, not what the last orchestrator pass saw. "Merged" is decided by a person, so whatever shows a person's actions has to notice them.

## 2026-11-21: A pull with a new dependency broke `pnpm dev`

- **What went wrong:** PR #8 added `zod` to `apps/api`. After `git pull`, the API watcher failed with "Cannot find module 'zod'" and waited. The web app kept running, so the page showed "Bad Gateway", which looked like a UI problem.
- **Before:** `pnpm dev` assumed `node_modules` matched the lockfile.
- **After:** `pnpm dev` runs `pnpm install` first: about 3 s when nothing changed. LEARNING.md has "After a pull: install, then run".
- **Why:** the gate already installs before every check (`checks.sh`); the dev loop now does the same.

## 2026-11-21: The web app started before the API, so the first page load failed

- **What went wrong:** right after `pnpm dev`, the open page called `/me` while the API was still compiling (about 10 s, against about 1 s for Vite). Vite's proxy logged `ECONNREFUSED`, and the page showed "Bad Gateway" until it was reloaded.
- **Before:** the web's `dev` script was `vite`.
- **After:** `node scripts/wait-for-api.mjs && vite`. Vite starts once the API's `/health` answers. After 60 s (`WAIT_FOR_API_MS`) it starts anyway, so the web app still runs on its own, against mocked fetch or an API on another port. Checked both paths: it finds a running API in 0.2 s; with `API_PORT=5999` it gives up after the limit and exits 0.
- **Why:** when the Vite URL is printed, the whole stack is ready. A "Bad Gateway" now means the API is really down.

## 2026-11-21: `/try` pointed a PR's web app at main's API

- **What went wrong (found while fixing the above):** `/try` started the PR's API with `API_PORT=5080`, but its web app without `API_PORT`. So the web app proxied to port 3000: main's API if one was running, so the PR's UI was checked against the wrong backend without any sign of it.
- **Before:** `pnpm --filter @levelpath/web dev --port 5081 --strictPort`.
- **After:** `API_PORT=5080` on the web command too, with a line saying why.
- **Why:** a check against the wrong server is worse than no check: it passes.

## 2026-11-21: A broken character merged into CLAUDE.md

- **What went wrong:** job 003's builder wrote `CLAUDE.md` with a U+FFFD replacement character in `/api/…`. The approver noticed it and called it "a small fix the human can make", but the PR merged with it. Prettier, ESLint and the tests don't look at characters.
- **Before:** nothing failed on text written in the wrong encoding.
- **After:**
  - **`checks.sh`** fails when any tracked or new file contains U+FFFD, and names the file. Checked: it failed on `main`'s `CLAUDE.md` and passed after the fix.
  - **`CLAUDE.md`** is fixed.
- **Why:** a defect the approver describes but the gate doesn't fail is left for a busy human to notice. A check that is easy to automate belongs in the gate.

## 2026-11-21: The spec assumed `messages.parse` returns `parsed_output: null` on a bad answer

- **What went wrong:** the Phase 4 spec (requirement 13) said to call `messages.parse` with `zodOutputFormat(suggestionSchema)` and repair when `parsed_output` is null. The planner checked the shipped `@anthropic-ai/sdk@1.12.0` (`lib/parser.mjs`, `helpers/zod.mjs`): the helper's `parse` **throws** on text that is not JSON or fails the schema, and it runs before the caller can look at `stop_reason`. The output the repair needs would be lost, and a `max_tokens` cut-off or a refusal would be logged as `error`.
- **Before:** a library's behaviour written into a spec from memory.
- **After:** Chris approved the deviation: `messages.create` with only the `{ type, schema }` of `zodOutputFormat`, `stop_reason` checked first, the first text block `JSON.parse`d (the raw string when that fails), and our `suggestionSchema.safeParse` as the only judge. The SDK is pinned to exactly `1.12.0`, so the checked behaviour is the one installed. Two tests pin it: a refusal falls back after one call, and non-JSON text is repaired on the second call (`anthropic.provider.spec.ts`).
- **Why:** the plan step "check the library, don't remember it" (2026-11-10) caught it before any code. It applies to behaviour as much as to versions: read the installed source when a design depends on what a call does on failure.

## 2026-11-21: `max_tokens: 512` would have cut answers off before any JSON

- **What went wrong:** the planner's first draft sent `max_tokens: 512` for a six-field answer. Both current models think by default, `claude-opus-5-5` can't turn it off, and thinking tokens count against `max_tokens`. A long think would end the call at `max_tokens` with no JSON, which falls back and is never repaired.
- **Before:** the token budget sized for the answer alone.
- **After:** `max_tokens: 2048` with `output_config.effort: "low"` (spec A16), checked against the claude-api reference by the orchestrator. A test asserts both values on the request.
- **Why:** on a model that thinks, `max_tokens` is the budget for thinking plus answer. Size it for both, and keep the thinking short with effort instead of starving it.

## 2026-11-22: `pnpm dev:llm` fails at once without a `.env`

- **What went wrong:** the plan said Nest CLI 12.0.12 skips a missing `--env-file` with "`<path>` not found - starting without it". The CLI's code does that, but it never runs: Node 24.12 reads `--env-file` from **every** argument, even after the script name, so the CLI's own process exits first with `node.exe: ../../.env: not found` (exit 9). Reproduced with a two-line script: `node s.js --env-file missing.env` exits 9 too.
- **Before:** the plan's claim came from reading the CLI's source, not from running the command.
- **After:** checked by running the same `nest start` with a scratch file in place of `.env` (it held `LLM_PROVIDER=mock`, no key): `dev-llm.env` overrides it, and the API stops with the `ANTHROPIC_API_KEY` message and never listens. `dev:llm` therefore needs a `.env`; `.env.sample` and `CLAUDE.md` say so. It still fails safely: nothing starts, nothing is called.
- **Why:** a code path read in a dependency is evidence only if the process actually reaches it. Run the real command, with the real runtime, before writing down what it prints.

## 2026-11-22: A € typed into a Git Bash `curl` reached the API as U+FFFD

- **What went wrong:** in the step 5 check, `curl -d '{"description":"… ~€1,200 each …"}'` from Git Bash on Windows sent the € as U+FFFD, so the mock found no amount and the result looked like an API bug. The API was right: the same body from a UTF-8 file gave `amountCents: 2400000`.
- **Before:** inline non-ASCII JSON in a shell command.
- **After:** send bodies with non-ASCII characters from a UTF-8 file (`curl --data-binary @body.json`), or through Node (`fetch`, as `evals/run.mjs` does). Noted here for the `verifier`, which runs these curls.
- **Why:** when the check's own input is broken, the check fails on the wrong thing. Keep the shell out of the bytes.

## 2026-11-22: The spec's `new Anthropic` grep matched `new AnthropicProvider`

- **What went wrong:** criterion 15 checks that no spec file builds a real client with `grep -rn "new Anthropic" apps/api/src --include=*.spec.ts`. It also matched the test's `new AnthropicProvider(…, stub)`, which builds no client.
- **Before:** the tests constructed the provider directly.
- **After:** the tests build it through `createSuggestionProvider(config, stubCreateClient)`, the same factory the API uses, so the grep finds nothing. The real protection is structural: `startApp` always overrides the provider, and `createClient` is injected.
- **Why:** a text search is a cheap tripwire, not a proof. Make the code match what the check means (no client built in tests), and keep the structural guard as the one that counts.

## 2026-11-22: Adding a required field broke tests the plan didn't list

- **What went wrong:** making `category` required (Phase 4) failed `apps/api/src/validation/zod-validation.pipe.spec.ts` (4 tests) and `apps/web/src/shared.test.ts`, which the plan's file list didn't name.
- **Before:** the plan listed the files that create purchase requests by searching for the create route, not for the schema.
- **After:** the bodies gained `category`; the "lists every issue" test now expects `category` among the issues. No assertion was loosened.
- **Why:** when a plan changes a shared schema, search for every use of the schema (`grep -rn createPurchaseRequestSchema`, and literal bodies), not only for the route. The full gate catches the rest, which is why it runs after every step.

## 2026-11-22: `pnpm eval -- --api x` passes the `--` through

- **What went wrong:** pnpm 10 hands `pnpm eval -- --api x` to the script as `["--", "--api", "x"]`. `util.parseArgs` treats everything after `--` as positionals, so `--api` would be ignored and the runner would test the default port instead.
- **Before:** nothing; found with a scratch package while planning.
- **After:** `evals/run.mjs` drops one leading `--` before `parseArgs`. Checked: `--api http://localhost:3917` reaches that API, `--api http://localhost:1` exits 1.
- **Why:** a runner that quietly tests the wrong server reports a pass rate for the wrong thing.

## 2026-11-22: The mock scored 12/15 on the evals

- **What went wrong:** review round 1 (verify, spec) found three eval cases the mock failed: "printer paper" hit the hardware keyword `printer`, "docking stations" had no keyword, and "Two … 1,450.00 EUR" had a quantity in words and a currency code. Round 1's fix documented 12/15 as the expected baseline; Chris then chose to make the mock pass every case instead.
- **Before:** the mock's first matching category won, quantities were digits only, and amounts needed a currency symbol. A mock eval run always showed three known failures, so a new failure could hide among them.
- **After:** the longest keyword found wins (`printer paper` and `docking station` are keywords), `one` to `twelve` count as quantities, and `EUR 1,200` and `1,200.00 EUR` are amounts (spec requirement 12, `mock.provider.ts`, new cases in `mock.provider.spec.ts`). `pnpm eval` against the mock gives `15/15 (100%)`.
- **Why:** with the mock at 100%, any failing case in a mock run is a real regression in the runner, the route or the mock. The cost: a mock run no longer says anything about suggestion quality; only a run against the real model does, which `evals/run.mjs` now says.
