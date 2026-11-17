# Phase 1, steps 1-2: Inventory and audit of the existing harness

Status: **DECIDED (revision 2, 2026-11-17).** Revision 1 below audited `git-adw` alone. [Revision 2](#revision-2-three-harnesses-one-set-of-parts) widens the sources to all three harnesses and records decisions D8-D11, which change D2 and D6. Nothing has been copied into this repo yet.

## Sources and how deeply I read them

| Repo (GitHub `murdskristians/...`)             | Role                                                                       | Commit examined        |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| `git-adw`                                      | **Base.** Headless, GitHub-issue-driven ADW layer (`adws/` + `.claude/`)   | `6f7049e` (2026-03-16) |
| `multi-agent-orchestration`                    | Donor: agents, `meta-agent` skill, commands, hooks. UI app is out of scope | `0623cc1` (2026-10-28) |
| `orchestrator`                                 | Donor: `planner`, `review-agent`, `meta-skill`, `meta-prompt`, `experts/*` | `d7679ef` (2026-03-18) |
| `tac-combined`, `orchestrator-agent-with-adws` | Earlier snapshots of the same family. Not used                             | -                      |

Read in full or in large part: `git-adw` `CLAUDE.md`, `settings.json`, `settings.local.json`, `.env.sample`, `adws/README.md`, `adw_modules/agent.py`, `adw_sdlc_zte_iso.py`, `pre_tool_use.py`, and the commands `feature`, `review`, `test`, `prime`, `conditional_docs`, `in_loop_review`, `start`. The donors' `planner`, `review-agent`, `build-agent` and `meta-skill` were read at the top.
Skimmed by frontmatter, filename or grep only: the other ~23 commands, most `adws/*.py` phase scripts, `data_types.py`, `workflow_ops.py`, `git_ops.py`, `github.py`, `state.py`, the other hooks. Treat statements about those as "looks like", to be confirmed when each is adapted.

## 1. Inventory: `git-adw` (base)

### `adws/` (Python 3.11+, run with `uv`)

| Piece                                                                                                                           | What it does                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adw_plan`, `adw_build`, `adw_test`, `adw_review`, `adw_document`, `adw_patch`                                                  | One script per phase. Run in the main checkout. State is shared through `agents/<adw_id>/adw_state.json`.                                                                                                              |
| `*_iso.py` (same phases + `adw_ship_iso`)                                                                                       | Same phases run inside a **git worktree** (`trees/<adw_id>/`) with its own ports, so runs can go in parallel.                                                                                                          |
| `adw_plan_build`, `..._test`, `..._review`, `..._document`, `..._test_review`, `adw_sdlc`, `adw_sdlc_iso`, `adw_sdlc_zte_iso`   | Composite pipelines that chain the phase scripts. `zte` = zero-touch: ends with **auto-approve and merge**.                                                                                                            |
| `adw_triggers/trigger_cron.py`, `trigger_webhook.py`                                                                            | The **T** in PITER. Cron polls GitHub every 20s for new issues or an `adw...` comment. Webhook (FastAPI `/gh-webhook`) does it instantly.                                                                              |
| `adw_modules/agent.py`                                                                                                          | Spawns `claude -p --model <m> --output-format stream-json --dangerously-skip-permissions` with a filtered environment. Model map per slash command: `base` = sonnet, `heavy` = opus for plan/implement/patch/document. |
| `adw_modules/agent_sdk.py`                                                                                                      | Alternative path through `claude-agent-sdk`, `permission_mode="bypassPermissions"`.                                                                                                                                    |
| `adw_modules/state.py`, `git_ops.py`, `github.py` (via `gh`), `workflow_ops.py`, `worktree_ops.py`, `data_types.py`, `utils.py` | State file, git and GitHub plumbing, worktree create/validate/remove, Pydantic types. Worktree ports are derived from the ADW id (backend 9100+n, frontend 9200+n) and written to `.ports.env`.                        |
| `github_uploader.py`, `r2_uploader.py`, `adw_tests/*`, `sandbox_poc.py`                                                         | Screenshot hosting (Cloudflare R2 / GitHub), tests for the above, E2B sandbox proof of concept.                                                                                                                        |

### `.claude/commands/` (30)

| Stage        | Commands                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classify     | `classify_issue`, `classify_adw`, `generate_branch_name`                                                                                                       |
| Plan         | `feature`, `bug`, `chore` (each writes a spec to `specs/`), `patch` (small fix plan from a review issue)                                                       |
| Build        | `implement`                                                                                                                                                    |
| Verify       | `test`, `test_e2e` (Playwright MCP), `resolve_failed_test`, `resolve_failed_e2e_test`, `prepare_app`, `start`, `stop`, `health_check`                          |
| Review       | `review` (spec vs diff, screenshots, JSON verdict with `blocker` / `tech_debt` / `skippable`), `in_loop_review` (checkout branch and open the app for a human) |
| Ship         | `commit`, `pull_request`, `document`, `cleanup_worktrees`, `install`, `install_worktree`                                                                       |
| Context/meta | `prime`, `conditional_docs`, `load_bundle`, `tools`, `track_agentic_kpis`, `create_command`                                                                    |

### `.claude/hooks/` (11 Python scripts, all `uv run`)

`pre_tool_use` (blocks `.env` access and `rm -rf`, logs every call), `post_tool_use`, `pre_compact`, `stop`, `subagent_stop`, `notification`, `user_prompt_submit`, `context_bundle_builder` (records files read/written and prompts so a later agent can `/load_bundle`), `utils/constants.py`, `utils/llm/anth.py` and `oai.py`. All except `pre_tool_use` are logging/observability, not guards.

### Config and docs

`settings.json` (permission allow/deny + hook wiring), `settings.local.json` (**personal, tracked in git**), `CLAUDE.md`, `pyproject.toml`, `.env.sample`, `.gitignore`.

## 2. Inventory: donors worth borrowing from

| Item                                                                                          | From                                    | What it is                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents/review-agent.md`                                                                      | orchestrator, tac-combined              | Read-only reviewer. Reads `git diff`, files issues in four tiers (Blocker/High/Medium/Low), writes `app_review/`, ends PASS/FAIL. Model `opus`. |
| `agents/planner.md`                                                                           | orchestrator                            | Thin wrapper that forwards a prompt to `/plan`. Model `opus`.                                                                                   |
| `agents/build-agent.md`                                                                       | all                                     | Writes exactly one file from a detailed spec (for parallel builds). Model `opus`.                                                               |
| `agents/scout-report-suggest(-fast).md`, `docs-scraper`, `playwright-validator`, `meta-agent` | multi-agent-orchestration               | Codebase scouting, doc scraping, browser validation, agent generator.                                                                           |
| `skills/meta-skill`, `meta-prompt`, `meta-agent`                                              | orchestrator, multi-agent-orchestration | Skills that author new skills, prompts and agents. Useful for writing the four new skills.                                                      |
| `commands/plan`, `quick-plan`, `plan_w_scouters`, `build`, `question`, `prime_*`              | multi-agent-orchestration               | In-session planning and build commands.                                                                                                         |
| Not wanted                                                                                    | -                                       | Output styles, TTS and chat-summary hooks, status line, `experts/*` self-improve, `start-orchestrator`, the Vue/FastAPI UI.                     |

## 3. Audit against this project (NestJS + Postgres RLS + React, pnpm, Windows)

### 3a. Works as-is

- ADW engine: `state.py`, `git_ops.py`, `github.py`, worktree create/remove, the base/heavy model map, `classify_*`, `commit`, `pull_request`, `generate_branch_name`, `create_command`, `load_bundle`.
- Hook plumbing: JSON on stdin, session logging, the `rm -rf` detector, `uv`-run scripts (uv 0.11.1 is installed here).
- The shape of the loop: issue → classify → plan → build → test → review → document → PR, run in isolated worktrees. It already covers P (issue), I (cron/webhook), T/E (worktrees) and R (review) of PITER.

### 3b. Assumes another stack (must be adapted)

1. **The "portable" commands are not portable.** A grep finds 103 matches of another project's specifics across 19 of 30 command files. Examples: an `## Expertise` block about a Pinecone/Gemini/Vertex RAG pipeline in `feature`, `bug`, `review`, `test`; "Relevant Files" pointing at `backend/**`, `src/**`, `scripts/**`; `conditional_docs` listing `app_docs/feature-fd233d2b-voice-input.md`.
2. **`feature`/`bug`/`chore` say "Don't use decorators. Keep it simple."** NestJS is built on decorators. Left in, the planner would steer away from the framework.
3. **`test.md` runs Python `py_compile` and `import main` checks** for a different backend, then `npm run lint`. Needs `pnpm build`, `pnpm lint`, `pnpm test` and the RLS isolation suite.
4. **`start`/`stop` call `./scripts/start.sh` and `stop.sh`**, which do not exist here. Phase 0 gave us `pnpm dev` and `pnpm db:up`.
5. **Library installs say `uv add`.** Our app uses `pnpm add`.
6. **Spec location and name** (`specs/issue-<n>-adw-<id>-sdlc_planner-<slug>.md`) differs from the KICKOFF layout (`docs/intent`, `docs/specs`, `docs/plans`).
7. **Worktree ports** are `BACKEND_PORT` / `FRONTEND_PORT` / `VITE_BACKEND_URL` in `.ports.env`. Our API reads `API_PORT`, and Vite has its own port setting.
8. **Parallel worktrees would share one Postgres.** Integration tests that create tenants and rows in two worktrees at once would collide. This needs a per-worktree database (or schema). New requirement created by RLS.
9. **"Never mock tests" (CLAUDE.md)** conflicts with Phase 4's mock LLM provider. Adapted rule: never mock the database or RLS; the LLM provider is the one allowed fake, because of cost and determinism.
10. **`settings.json` allowlist** has `Bash(npm:*)` but no `pnpm`/`docker compose`, and a blanket `Write`. The deny list is only `rm -rf` and force-push.
11. **`CLAUDE.md` describes the `git-adw` repo**, not an app. It also lists `.claude/agents/` and `adws/adw_workflows/`, which do not exist in the repo.

### 3c. Defects and risks found by reading

| #   | Finding                                                                                                                                                                                                                                                                                                                                 | Evidence                                                     | Confidence                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Blocking hooks are probably inert.** Every hook is wired as `uv run <script> \|\| true`. `pre_tool_use.py` blocks by `sys.exit(2)`, and `\|\| true` turns that into exit 0.                                                                                                                                                           | `settings.json` lines 30-110; `pre_tool_use.py` lines 97-108 | High from shell semantics. **Not yet run:** my attempt to execute the hook from the cloned repo was denied by the permission classifier. I will prove it in Phase 1 after the file is imported here. |
| R2  | **`.env` guard has gaps.** It matches `cat`, `echo >`, `touch`, `cp`, `mv` and file-tool paths. By reading the regexes, `head .env`, `grep KEY .env`, `Get-Content .env`, `type .env`, `printenv` would pass. KICKOFF wants "commands that would print or read secrets" blocked.                                                        | `pre_tool_use.py` lines 57-85                                | Medium-high (regex reading, not executed)                                                                                                                                                            |
| R3  | **Personal file tracked in git.** `.claude/settings.local.json` holds ~137 allow rules with absolute paths from another machine/project, PID-specific `taskkill` lines, `git push origin main`, `gh pr close`, `git branch -d`. It must not be copied.                                                                                  | `settings.local.json`                                        | High                                                                                                                                                                                                 |
| R4  | **Cost/safety defaults.** Agents run with `--dangerously-skip-permissions`, **no `--max-turns`**, a 45-minute timeout per call, and `heavy` mode uses opus. `.env.sample` calls `ANTHROPIC_API_KEY` "Required", but `get_claude_env()` only forwards it if set, so with no key the `claude` CLI should use your logged-in subscription. | `agent.py` lines 27-48, 148-181, 228-256; `.env.sample`      | High for the code facts. "Uses subscription when key is unset" is **unverified**; needs one 1-turn `claude -p` test.                                                                                 |
| R5  | **Automation conflicts with your rules.** `trigger_cron.py` polls every 20s and starts a full run on any new issue with no comments. `adw_sdlc_zte_iso` auto-merges. KICKOFF: no tight schedules, no automatic token spend, human approval required.                                                                                    | `adws/README.md` lines 105-127; `adw_sdlc_zte_iso.py`        | High                                                                                                                                                                                                 |
| R6  | **Hook latency.** Each tool call spawns up to 3 separate `uv run` processes (pre, post, bundle builder). On Windows this adds up.                                                                                                                                                                                                       | `settings.json`                                              | Medium (not measured)                                                                                                                                                                                |
| R7  | **Subagents default to `opus`** in the donor agents. On a subscription this burns the quota fastest.                                                                                                                                                                                                                                    | donor `agents/*.md` frontmatter                              | High                                                                                                                                                                                                 |

### 3d. Gaps vs the KICKOFF checklist (my harness has nothing for these)

| KICKOFF item                                                                          | Status in your harness                                                                               |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CLAUDE.md` under one page with commands, verifying block, "Things Claude gets wrong" | Exists but describes the wrong thing. Rewrite.                                                       |
| Skills `nestjs-endpoint`, `rls-data-access`, `llm-call`, `feature-workflow`           | None exist. Only skill-authoring skills (`meta-skill`) exist as donors. **New.**                     |
| Subagent `planner`                                                                    | Donor is a pass-through to `/plan`, not a read-only explorer that writes `plan.md`. Adapt.           |
| Subagent `verifier` (runs app + tests, reports only)                                  | Nothing equivalent. `test`/`test_e2e` run tests but also fix. **New.**                               |
| `reviewer-bugs`, `reviewer-security`, `reviewer-spec` with Important/Nit              | One `review` command (spec + screenshots) and one donor `review-agent` (4 tiers). Split and re-tier. |
| Hook: format/lint changed file after edit                                             | None. **New.**                                                                                       |
| Hook: block test-file edits during a bug fix                                          | None. **New.** Needs a way to signal task type (see decision D5).                                    |
| Hook: block edits to applied migrations                                               | None. **New.**                                                                                       |
| Hook: block commands that read `.env`                                                 | Exists but see R1, R2.                                                                               |
| Slash commands `/intent`, `/spec`, `/plan`, `/review`                                 | `plan` exists in donors. `/intent` and `/spec` do not. `/review` must merge three reviewers.         |
| `REVIEW.md`; templates for intent, spec, plan                                         | None. The plan format lives inline inside `feature.md`.                                              |

## 4. Decisions I need from you

**D1. Shape of the loop.** Your harness is _GitHub-issue-driven_ (the issue is the intent). KICKOFF wants _file-driven_: `intent.md` → `spec.md` → `plan.md` in `docs/`.

- A (recommended): Files are the contract. In-session commands `/intent`, `/spec`, `/plan` produce them, and the ADWs consume the same files (issue body links to a spec). Shows "my factory, improved where it fell short".
- B: Keep issue-driven only; generate the three documents inside the ADW.
- C: Drop the ADWs, use only in-session commands. Simplest, but loses your PITER story.

**D2. How much of `adws/` to bring.** 50 Python files is more than a demo needs.

- A (recommended): Keep the `_iso` (worktree) set for plan, build, test, review, document, `adw_ship_iso` and `adw_sdlc_iso`; keep the modules and both triggers. Drop the non-iso duplicates, `zte`, R2/E2B/sandbox and their tests.
- B: Bring everything and prune later.
- C: Only plan, build, review, to keep it very small.

**D3. Hook language.** Python with `uv` (your current way, works here) or port to Node.

- A (recommended): Keep Python/uv. Fix R1 and R2, and write the new hooks (format-on-edit, migration lock, test lock) in the same style. Port-to-Node stays an optional later item.
- B: Rewrite all hooks in Node/TypeScript to match "TypeScript everywhere".

**D4. Automation and cost policy** (R4, R5, R7).

- A (recommended): Triggers are opt-in and documented as "run on demand"; remove `zte` auto-merge so a human approves; add `--max-turns` to every `claude -p` call; default models to sonnet, opus only by explicit flag; leave `ANTHROPIC_API_KEY` unset and verify with one 1-turn call that the subscription login is used.
- B: Keep your defaults and just document them.

**D5. Signalling "this is a bug fix" for the test-lock hook.** The hook must know the task type.

- A (recommended): A file `.claude/task-type` containing `bugfix` or `feature`, written by `/plan` (and the ADW branch prefix `bug-` sets it too). The hook reads it.
- B: Infer from the git branch name only (`bug-*` / `fix-*`).
- C: An environment variable you set per session.

**D6. Reviewers.** (recommended) Split into `reviewer-bugs`, `reviewer-security`, `reviewer-spec`, all read-only, findings tiered Important / Nit, driven by a new `REVIEW.md`. Base `reviewer-bugs` on your donor `review-agent`; base `reviewer-spec` on your existing `review.md` logic (spec vs diff); `reviewer-security` is new. Say if you prefer to keep your four tiers instead.

**D7. Where files live.** (recommended) `.claude/` and `adws/` at the repo root, with `pyproject.toml` beside `package.json`. `adws/` is a small addition to the KICKOFF layout, and ESLint/Prettier must ignore the Python and `.venv`.

Things I will do unless you object: leave `settings.local.json` out and add it to `.gitignore`; rebuild the allowlist for `pnpm` and `docker compose`; remove the other project's "Expertise" blocks and the "no decorators" line; replace `CLAUDE.md`.

## 5. Proposed steps once decisions are in

1. **Import as-is** the chosen subset into this repo, untouched, so git history shows _your_ harness unmodified (you commit; message names source repo + commit). This is the "before".
2. Prove R1 and R2 with the imported hook (evidence in the changelog).
3. Adapt in small steps, each its own commit and `HARNESS_CHANGELOG.md` entry "before → after → why".
4. Fill the gaps in 3d.
5. Test that every hook fires and every skill triggers, and paste the evidence.

I will write `docs/plans/phase-1.md` with exact files for steps 1-5 and wait for your approval before copying anything.

---

## Revision 2: three harnesses, one set of parts

Date: 2026-11-17. Chris asked to combine the practices of all three of his harnesses, keep **both engines**, publish the repo **publicly**, and make sure **nothing ever merges without his approval**.

### R2.1 Sources

| Source                                                              | Commit                | Role in revision 2                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git-adw`                                                           | `6f7049e`             | **Engine L3** (headless ADWs), plus its plan formats, review-against-spec, guard hook and PITER trigger. Its Windows fixes were made only in MyPersonalWebsite's git-ignored `adws/` copy and are ported from there. |
| `tac-combined` (fork of `multi-agent-orchestration`, by IndyDevDan) | `f739cbb`             | Donor: `scout-report-suggest`, `review-agent`, `playwright-validator`, `meta-agent`, the `meta-prompt` skill and the rules in its `CLAUDE.md`.                                                                       |
| Software factory v2 (fork `murdskristians/zazencodes-season-3`)     | the "no merge" commit | **Engine L2** (`/factory` skill, `job`/`gate`/`route`/`port` scripts, dashboard) and its agents: intake, spec-writer, builder, reviewers, approver. Already ported to Windows. GPLv3.                                |

### R2.2 Inventory: tac-combined

| Piece                                                                                    | What it does                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/` (FastAPI, asyncpg, Claude Agent SDK), `frontend/` (Vue), `migrations/` (Neon) | Orchestrator agent that creates, commands and watches other agents, with a live event-stream UI. Needs an API key and a Postgres database.                                 |
| `.claude/agents/scout-report-suggest(-fast).md`                                          | Read-only scout: finds the files and patterns relevant to a task and suggests an approach.                                                                                 |
| `.claude/agents/review-agent.md`                                                         | Read-only reviewer: reads the diff, files findings as Blocker / High / Medium / Low, ends PASS or FAIL.                                                                    |
| `.claude/agents/build-agent.md`                                                          | Writes exactly one file from a detailed spec, so many can build in parallel.                                                                                               |
| `.claude/agents/playwright-validator.md`                                                 | Opens the app in a browser and validates a UI change with screenshots.                                                                                                     |
| `.claude/agents/meta-agent.md`, `.claude/skills/meta-prompt/`                            | Generate new agents and prompts: the harness writes its own parts.                                                                                                         |
| `.claude/commands/orch_*.md`                                                             | Pipelines run by the orchestrator: plan → build → test → review → document, `_iso` with a worktree per builder; `orch_sdlc_zte` **merges to main** when every gate passes. |
| `CLAUDE.md` rules                                                                        | Never silently fail; never mock tests; frontend changes need a visual check; don't commit unless asked; actually read the whole file.                                      |

### R2.3 Inventory: software factory v2

| Piece                                                                                                                     | What it does                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/factory/SKILL.md`                                                                                         | The in-session orchestrator: `/factory run` drains GitHub issues labeled `factory`, `concurrency` jobs at a time, spawning every agent as a background subagent.                          |
| `factory/bin/job`                                                                                                         | The only writer of `job.json`. A state machine with legal transitions, a round limit, locking, GitHub labels and comments, worktree create and remove, and cost per job from transcripts. |
| `factory/bin/gate`, `factory/checks.sh`                                                                                   | Deterministic gate: runs the repo's checks in the job's worktree and fails if protected paths changed. Also the builder's Stop hook.                                                      |
| `factory/bin/route`, `factory/config.json`                                                                                | Risk and surfaces from intake → which reviewers run, on which model.                                                                                                                      |
| `factory/bin/port`                                                                                                        | Finds or stops the process on a port (Windows has no `lsof`).                                                                                                                             |
| `factory/dashboard.html`                                                                                                  | Static board of all jobs, their rounds, verdicts, cost and time.                                                                                                                          |
| Agents `intake`, `spec-writer`, `builder`, `reviewer-code`, `reviewer-security`, `reviewer-ux`, `reviewer-ui`, `approver` | Intake decides ACCEPT / NEEDS-INFO / REJECT and rates risk and surfaces; issue text is passed as quoted data, never as instructions. The approver used to merge on APPROVE; see D9.       |

### R2.4 Practice matrix

| Practice                                                                      | From                  | Lands in                                                                                                                       |
| ----------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Issue as the prompt; status comments with a bot marker; screenshots in the PR | git-adw               | ADW driver (`[ADW-BOT]`, `github_uploader`); the factory keeps its own marker comments                                         |
| Trigger (the T in PITER)                                                      | git-adw               | `trigger_cron`, opt-in, reacts only to an `adw` comment by the owner (public issues are untrusted input); webhook not imported |
| Worktree and ports per run                                                    | all three             | both drivers; a database per run arrives in Phase 2                                                                            |
| Classify feature / bug / chore; typed plan formats                            | git-adw               | intake writes `TYPE:`; the planner uses `docs/templates`; `TYPE: bug` turns the test lock on                                   |
| Test → resolve loop                                                           | git-adw               | gate (exit code of `checks.sh`) plus builder rounds                                                                            |
| Review against the spec, with screenshots; patch from findings                | git-adw               | `reviewer-spec`; CHANGES → next builder round                                                                                  |
| Intake with rescope, risk and surfaces; issue text quoted as data             | factory               | `intake` (sonnet)                                                                                                              |
| State machine as single writer; round limit                                   | factory               | `factory/bin/job`                                                                                                              |
| Routing by risk and surface                                                   | factory               | `config.json` + `route`, also for the planner and builder models; ADW reads the same tables                                    |
| Protected paths                                                               | factory               | gate (diff check) and guard hook (edits inside worktrees)                                                                      |
| Approver with evidence                                                        | factory               | `approver`, recommendation only (READY / ESCALATE)                                                                             |
| Cost and time per run; dashboard                                              | factory               | dashboard (L2); `total_cost_usd` per phase in the final ADW comment (L3)                                                       |
| Scouts before planning                                                        | tac-combined          | `scout` (haiku, read-only), routed for high risk                                                                               |
| Risk tiers, PASS / FAIL                                                       | tac-combined          | REVIEW.md: Blocker and High → Important, Medium and Low → Nit, with a nit cap                                                  |
| Visual validation of UI changes                                               | tac-combined, git-adw | `verifier` with agent-browser                                                                                                  |
| Meta-agent, meta-prompt                                                       | tac-combined          | kept as authoring tools                                                                                                        |
| Never silently fail; read the whole file; don't commit unless asked           | tac-combined          | `CLAUDE.md`                                                                                                                    |
| Guard hook for `.env` and `rm -rf`                                            | git-adw               | `guard.py`, blocking, more `.env` forms, one process per tool call                                                             |
| `in_loop_review` (run the branch for a human)                                 | git-adw               | `/try <pr>`, the owner's check before merging                                                                                  |

**Dropped, each with a changelog line when the code is removed:**

- ship, zte and auto-merge: D9.
- Logging hooks and context bundles: R6.
- tac's web UI, Postgres/Neon and API key: the dashboard and issue comments cover observability.
- One-file parallel build agents: worktree-per-run gives the parallelism.
- A separate documenter: docs become part of the builder's definition of done.
- The KPI command.
- The webhook trigger.
- Separate UX and UI reviewers: folded into `verifier`.

### R2.5 Decisions (2026-11-17)

- **D8. Both engines, one set of roles.** The factory (L2) and the ADWs (L3) stay. They share `.claude/agents/*`, `factory/checks.sh`, the guard hooks, the skills, `REVIEW.md` and the templates. The factory spawns roles as subagents; ADW phases run the same roles headless with `claude -p --agent <role>`. Interactive commands (L1) spawn them too. Every role reads the same prompt header and writes the same files, so no driver parses agent prose. Replaces D2's phase list: no `adw_document_iso`, no `adw_ship_iso`.
- **D9. Human-only merge, in four layers.** No driver has a merge command. The guard hook blocks `gh pr merge`, `gh api …/merge` and `git push` to `main`. `settings.json` denies `Bash(gh pr merge:*)`. Branch protection on `main` requires a PR and blocks force-pushes, and CI is required from Phase 5. The approver's verdict is a recommendation, READY or ESCALATE. Both drivers end with a ready PR, `decision.md` and the `needs-human` label.
- **D10. Public GitHub repo, GPLv3.** The factory code is GPLv3, so the repo ships `LICENSE` (GPLv3) and `CREDITS.md`. Before the first push, Chris decides whether `KICKOFF.md` stays public.
- **D11. Model policy.** Every role defaults to sonnet, and intake does not use Fable. Routing uses opus only for the planner, builder and security reviewer on high-risk jobs. `scout` runs on haiku. Headless phases are capped with `--max-turns` and `--max-budget-usd`.
- **D6 revised.** The reviewers are `reviewer-bugs`, `reviewer-security` and `reviewer-spec`, plus a `verifier` that runs in every round. UX and UI review are folded into the verifier.

### R2.6 Spike evidence (2026-11-17, Claude Code 2.1.312)

A throwaway project with one probe agent (`model: haiku`, a frontmatter Stop hook), a PreToolUse hook in `settings.json` that blocks any Bash command containing `secret.txt`, and a Stop hook in `settings.json`. Four `claude -p` calls cost $0.0044 API-equivalent in total.

| Question                                                                        | Result                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does `claude -p --agent probe` load a project agent?                            | **Yes.** It answered with the code word that exists only in the agent's prompt, and `modelUsage` shows only `claude-haiku-5-5`, the agent's model.                                                                                             |
| Does a PreToolUse hook block under `--dangerously-skip-permissions`?            | **Yes.** The hook saw `permission_mode: bypassPermissions`, exited 2, and the agent reported the block. The secret never appeared in the output.                                                                                               |
| Does the agent's frontmatter Stop hook fire under `--agent`?                    | **No.** Only the `settings.json` Stop hook fired. Its event carries `transcript_path` (not `agent_transcript_path`) and `agent_type: "probe"`. ADW therefore runs the gate explicitly after the builder, and `gate --hook` reads either field. |
| Does `--max-budget-usd` stop a session?                                         | **Yes**, on subscription login: `subtype: error_max_budget_usd`, exit 1. It checks after each turn, so a run can overshoot by one turn.                                                                                                        |
| Which credentials does headless `claude -p` use with `ANTHROPIC_API_KEY` unset? | `apiKeySource: none`, so the logged-in subscription. This confirms R4.                                                                                                                                                                         |
