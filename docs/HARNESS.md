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
 watch all     factory/bin/serve → http://127.0.0.1:8000   (Board: every run · Agents: live · prompt box → L3)
 L3 unattended  adws/          (Python, `claude -p --agent <role>`, an `adw` comment)
 ───────────────────────────────────────────────────────────────────────────────────
 roles      intake · scout · planner · builder · verifier ·
            reviewer-bugs · reviewer-spec · reviewer-security · approver
 knowledge  CLAUDE.md · skills · REVIEW.md · docs/templates
 gate       factory/checks.sh   pnpm install · build · lint · test   (+ RLS suite, Phase 2)
 guards     .claude/hooks/guard.py   (blocks)  ·  format_on_edit.py
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
  - `guard.py` blocks `gh pr merge`, API merges, approvals and pushes to `main`;
  - `settings.json` denies `gh pr merge`;
  - branch protection.

  The guard runs even under `--dangerously-skip-permissions` (tested).

- **Secrets:** no tool or shell command may touch `.env`, dump the environment or expand a secret-named variable.
- **Tests stay honest:** in a bug run, tests that exist on `main` are locked; agents can't edit applied migrations or the harness's own protected files. The gate also fails any branch that changed a protected file.
- **Untrusted input:** issue text reaches agents only as quoted data. The ADW trigger answers only the owner's comments.
- **Cost:**
  - every agent defaults to sonnet; opus only for high-risk routing;
  - headless agents have turn and dollar caps;
  - nothing runs on a schedule unless started;
  - no API key is passed on, so runs use the subscription.

## Where each part came from

Code from the public ZazenCodes factory (GPLv3) was adapted here. From my two private course harnesses, git-adw and tac-combined, only **ideas** came over: every file listed as an idea was written for this repository.

| Part                                                         | Source                                                   | What changed                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/factory/`, `factory/bin/*`, `dashboard.html` | factory fork `82b82ca` (ZazenCodes, GPLv3)               | Windows port, never merges, shared roles, risk-routed models, `gate --run` for every driver, the control room (`serve`) |
| `factory/tests/run_test.py`                                  | written for the fork                                     | 42 checks: Windows, locks, gate, hook, cost, no-merge, shots                                                            |
| `intake`, `builder`, `approver`, `reviewer-security`         | factory fork                                             | `TYPE:` (feature, bug, chore), this stack, tenant isolation; the approver only recommends                               |
| `planner`                                                    | factory `spec-writer`, plus git-adw's typed plans (idea) | writes `spec.md` and `plan.md`; checks library versions first                                                           |
| `verifier`, `reviewer-bugs`, `reviewer-spec`, `scout`        | written here, from ideas in all three                    | run the app, find bugs, trace the spec, scout the code; findings Important/Nit (`REVIEW.md`)                            |
| `adws/`                                                      | written here, from git-adw's ADW design (idea: PITER)    | roles via `claude -p --agent`, file contracts, the factory's gate, caps, no merge, owner-only trigger                   |
| `.claude/hooks/guard.py`, `format_on_edit.py`                | written here                                             | blocks secrets, merges, migrations, test edits in bug runs, protected paths; formats the edited file                    |
| `/intent /spec /plan /verify /review /try`                   | written here                                             | the L1 driver over the same roles                                                                                       |
| `CLAUDE.md`, `REVIEW.md`, `docs/templates/`, skills          | written here                                             | -                                                                                                                       |

The changelog records what changed and why. Credits and licences are in [CREDITS.md](../CREDITS.md).

## Try it

```bash
bash factory/checks.sh                       # the gate, on your checkout
python3 -X utf8 factory/tests/run_test.py    # the factory scripts, end to end, offline
uv run adws/adw_tests/health_check.py        # the ADW prerequisites (one capped haiku call)
```
