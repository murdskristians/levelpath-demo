# The harness

My agentic software factory, pointed at this stack (NestJS, Postgres RLS, React) and improved where it fell short. It combines three harnesses I built or adapted:

- **git-adw**: my Tactical Agentic Coding ADWs.
- **tac-combined**: my fork of IndyDevDan's multi-agent orchestrator.
- **My Windows fork of the ZazenCodes software factory v2.**

Every change from the originals is in [HARNESS_CHANGELOG.md](HARNESS_CHANGELOG.md), as before → after → why.

## One set of parts, three drivers

```
 drivers (who orchestrates)               same roles · same files · same gate · same guards
 L1 pair        you + /intent /spec /plan /verify /review
 L2 supervised  /factory run   (a skill in your Claude Code session, dashboard)
 watch all      factory/bin/serve → http://127.0.0.1:8000   (Board: every run · Agents: live · prompt box → L3)
 L3 unattended  adws/          (Python, `claude -p --agent <role>`, an `adw` comment)
 ───────────────────────────────────────────────────────────────────────────────────
 roles      intake · scout · planner · builder · verifier ·
            reviewer-bugs · reviewer-spec · reviewer-security · approver
 knowledge  CLAUDE.md · skills · REVIEW.md · docs/templates · code graph (graphify)
 gate       factory/checks.sh   pnpm install · build · lint · test   (the RLS suite is in pnpm test; needs pnpm db:up)
 guards     .claude/hooks/guard.py   (blocks)  ·  format_on_edit.py  ·  graph_first.py (graph before code)
 end        PR ready + decision.md + label factory:needs-human  →  only Chris merges
```

**The idea:**

- **Scripts own the steps that must be deterministic:** state, the gate, routing, merging (none).
- **Agents own judgment:** intake, spec and plan, code, reviews.
- **A person owns the merge.**

The drivers differ only in who orchestrates, so moving work along the autonomy dial changes no files.

## A run, step by step

| Step      | Who                                                | Writes                                           | First line the driver reads                |
| --------- | -------------------------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| intake    | `intake` agent                                     | `intake.md`                                      | `DECISION: ACCEPT \| NEEDS-INFO \| REJECT` |
| route     | `factory/bin/route` (L2), `adws/.../roles.py` (L3) | reviewers and models from `config.json`          | -                                          |
| scout     | `scout` agent, high risk only                      | `scout.md`                                       | `SCOUT: …`                                 |
| plan      | `planner` agent                                    | `spec.md`, `plan.md`                             | a title                                    |
| build     | `builder` agent, in a worktree                     | code, the draft PR, `build.md`                   | `STATUS: READY \| BLOCKED`                 |
| gate      | `factory/bin/gate`                                 | `round-N/checks.md`                              | `GATE: PASS \| FAIL`                       |
| review    | `verifier` + reviewers, in parallel                | `round-N/review-<pass>.md`, screenshots          | `VERDICT: PASS \| CHANGES`                 |
| approve   | `approver` agent                                   | `decision.md`                                    | `READY \| ESCALATE`                        |
| hand-over | the driver                                         | PR ready, decision and screenshots posted, label | -                                          |

A gate failure or a CHANGES verdict starts the next build round, up to three, then a person decides. Every agent prompt starts with the same header: `Job: … Job folder: … Main checkout: … Worktree: … Branch: … Base: … Issue: …`.

## Guardrails

- **Nothing merges but Chris.** Four layers:
  - no merge command in any driver;
  - `guard.py` blocks `gh pr merge`, API merges, approvals and pushes to `main` (also as `HEAD`, `@`, `git -C`, `--all`);
  - `settings.json` denies `gh pr merge`;
  - branch protection on `main`: a PR is required, also for admins. The agents act as Chris's account, so without "include administrators" GitHub would let them push to `main` directly.

  The guard runs even under `--dangerously-skip-permissions` (tested).

- **Run files land where the run reads them:** in a job folder an agent may write only its own file (`intake.md`, `spec.md`, `plan.md`, `build.md`, `decision.md`, `round-N/review-<pass>.md`), and the guard blocks those names anywhere else.
- **A run never ends looking busy:** a crash, or a stop such as a gate that couldn't run, ends at `needs-human` with the reason in `decision.md`.
- **One Postgres for every checkout:** `docker-compose.yml` names one project (`levelpath-demo`), so a run's worktree reaches the same database instead of creating its own. A run doesn't start while it's down (`gate --services`: the control room, `job create`, the ADWs), the guard stops agents from stopping or removing it, and a test run that was killed has its database dropped by the next one.

- **Secrets:** no tool or shell command may touch `.env`, dump the environment or expand a secret-named variable.
- **Tests stay honest:** in a bug run, tests that exist on `main` are locked; agents can't edit applied migrations or the harness's own protected files. The gate also fails any branch that changed a protected file.
- **Untrusted input:** issue text reaches agents only as quoted data. The ADW trigger answers only the owner's comments.
- **Cost:**
  - every agent defaults to sonnet; opus only for high-risk routing;
  - headless agents have turn and dollar caps;
  - nothing runs on a schedule unless started;
  - no API key is passed on, so runs use the subscription.

## The code graph

- **What:** [graphify](https://github.com/Graphify-Labs/graphify) parses the repo into a graph of files, symbols and the links between them. It lives in `graphify-out/` in the main checkout (git-ignored), and graphify's git hooks rebuild it after every commit, checkout and pull there. Job worktrees never have one: agents query the main checkout's.
- **Who must use it:** the planner and the builder, in every driver. `.claude/hooks/graph_first.py` blocks their first read or search of `apps/`, `packages/` or `db/` until they have run one `graphify query`, `explain` or `path`. Without a graph it enforces nothing and warns once per agent.
- **What it bought:** measured on all three drivers in November 2026, quality was the same with and without it. Planners made about 16% fewer tool calls, and total exploration tokens fell by 3%, or 10% counting the better of two L3 runs. A repo this small is easy to search either way; the graph is expected to matter more on a larger one.

## Where each part came from

Code from the public ZazenCodes factory (GPLv3) was adapted here. From my two private course harnesses, git-adw and tac-combined, only **ideas** came over: every file listed as an idea was written for this repository.

| Part                                                              | Source                                                   | What changed                                                                                                                                                               |
| ----------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/factory/`, `factory/bin/*`, `dashboard.html`      | factory fork `82b82ca` (ZazenCodes, GPLv3)               | Windows port, never merges, shared roles, risk-routed models, `gate --run` for every driver, the control room (`serve`)                                                    |
| `factory/tests/run_test.py`                                       | written for the fork                                     | 86 checks: Windows, locks, gate, hook (L2 and L3), cost, no-merge, shots, the control room                                                                                 |
| `intake`, `builder`, `approver`, `reviewer-security`              | factory fork                                             | `TYPE:` (feature, bug, chore), this stack, tenant isolation; the approver only recommends                                                                                  |
| `planner`                                                         | factory `spec-writer`, plus git-adw's typed plans (idea) | writes `spec.md` and `plan.md`; checks library versions first                                                                                                              |
| `verifier`, `reviewer-bugs`, `reviewer-spec`, `scout`             | written here, from ideas in all three                    | run the app, find bugs, trace the spec, scout the code; findings Important/Nit (`REVIEW.md`)                                                                               |
| `adws/`                                                           | written here, from git-adw's ADW design (idea: PITER)    | roles via `claude -p --agent`, file contracts, the factory's gate, caps, no merge, owner-only trigger                                                                      |
| `.claude/hooks/guard.py`, `format_on_edit.py`                     | written here                                             | blocks secrets, merges and pushes to main, migrations, test edits in bug runs, protected paths, misplaced run files, stopping the shared Postgres; formats the edited file |
| `/intent /spec /plan /verify /review /try`                        | written here                                             | the L1 driver over the same roles                                                                                                                                          |
| `.claude/hooks/graph_first.py`, `adws/adw_tests/test_pipeline.py` | written here                                             | the planner and builder query the graph first; the ADW pipeline's unit tests                                                                                               |
| `.claude/skills/graphify/`, graphify's hooks                      | graphify 0.9.119 (Graphify-Labs, Apache 2.0)             | installed as is; licence and NOTICE kept next to the skill                                                                                                                 |
| `CLAUDE.md`, `REVIEW.md`, `docs/templates/`, skills               | written here                                             | -                                                                                                                                                                          |

The changelog records what changed and why. Credits and licences are in [CREDITS.md](../CREDITS.md).

## Try it

```bash
bash factory/checks.sh                       # the gate, on your checkout
python3 -X utf8 factory/tests/run_test.py    # the factory scripts, end to end, offline
python3 -X utf8 .claude/hooks/test_hooks.py  # every hook: guard, format_on_edit, graph_first
python3 -X utf8 adws/adw_tests/test_pipeline.py  # the ADW pipeline's own logic, no model
uv run adws/adw_tests/health_check.py        # the ADW prerequisites (one capped haiku call)
```
