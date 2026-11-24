# Demo: the harness

A 7-minute walkthrough. The point is the **harness**: one set of agent roles that can build this app three ways, from pairing with me to running unattended, with the same files, the same gate and the same guards every time. The app (multi-tenant purchase requests, Postgres RLS, an LLM feature) is what it built.

## Before the call (10 minutes)

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed   # Postgres healthy, two companies seeded
pnpm dev                                        # API :3000, web :5173 (the mock LLM, free)
factory/bin/serve                               # the control room on http://127.0.0.1:8000
```

Open, in this order:

1. The control room: http://127.0.0.1:8000 (Board tab).
2. The app: http://localhost:5173, as Alice (Acme).
3. In the editor: `CLAUDE.md`, `.claude/agents/`, `.claude/hooks/guard.py`, `factory/checks.sh`, `docs/HARNESS_CHANGELOG.md`.
4. On GitHub: PR #11 (L1), PR #13 and PR #7 (L2), PR #2 (L3).
5. A Claude Code session in this repo, idle.

## The script

### 0:00–0:45 The idea

> "I didn't write this app by hand, and I didn't vibe-code it either. I built a harness first: agent roles with written contracts, a deterministic gate, and hooks that block what an agent must never do. Then I used it to build the app. There are three ways to drive it, and the only thing that changes between them is **who orchestrates**. The roles, files, gate and guards are the same."

Show the diagram at the top of [HARNESS.md](HARNESS.md):

```
 L1 pair        me + /intent /spec /plan /verify /review
 L2 supervised  /factory run   (Claude Code orchestrates, I watch the dashboard)
 L3 unattended  adws/          (Python runs `claude -p` per role, triggered by an issue comment)
```

### 0:45–2:00 The parts every driver shares

Open each for a few seconds:

| Part           | File                                        | One line to say                                                                                                                                               |
| -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles          | `.claude/agents/` (9 files)                 | intake, scout, planner, builder, verifier, three reviewers, approver. Each writes one file whose first line is its verdict, so a script can read it.          |
| Knowledge      | `CLAUDE.md`, `.claude/skills/`, `REVIEW.md` | the rules, plus skills for RLS data access, NestJS endpoints and LLM calls; `REVIEW.md` defines Important vs Nit.                                             |
| Plan formats   | `docs/templates/`                           | intent → spec (testable acceptance criteria) → plan (files, steps, checked library versions).                                                                 |
| The gate       | `factory/checks.sh`                         | install, build, lint, all tests against real Postgres, an encoding check. Same script in every driver. A failing gate means no reviewer even starts.          |
| The guards     | `.claude/hooks/guard.py`                    | runs before every tool call of every agent, even with permissions skipped: blocks `.env`, env dumps, `rm -rf`, merges, approvals, pushes to main, migrations. |
| The human gate | branch protection + the guard               | every driver ends with a PR. **Only I merge.**                                                                                                                |

**Live moment (20 s):** feed the guard the tool call an agent would make, exactly as Claude Code does before every call:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr merge 13"}}' | python3 -X utf8 .claude/hooks/guard.py
# BLOCKED by .claude/hooks/guard.py: agents never merge PRs (D9). Chris reviews and merges every PR on GitHub.
```

Then `python3 -X utf8 .claude/hooks/test_hooks.py`: 81 checks of every rule, offline, in a few seconds.

### 2:00–3:15 L1: pairing (Phase 4, the LLM feature)

> "For the risky, design-heavy work I pair. I bring the idea; the planner agent writes the spec and plan; I approve; we build together; then the same verifier and reviewers the factory uses check it."

Walk the artifact trail of **Suggest fields**:

1. `docs/intent/purchase-request-suggestion.md`: why and for whom, in my words.
2. `docs/specs/purchase-request-suggestion.md`: requirements and acceptance criteria.
3. `docs/plans/purchase-request-suggestion.md`: files, steps, library versions checked with `pnpm view` (Claude's remembered versions were wrong twice before).
4. PR #11: four review rounds. Point at one real finding that was fixed.

Then show the feature failing safely in the app: type `mock:invalid` in the description and click **Suggest fields**. The model's answer fails the schema, the one repair attempt fails too, and the form stays usable with a note. (`mock:timeout` shows the 15-second deadline instead; too slow for a demo.) Mention `pnpm eval`: 15 cases, 15/15 on the mock, a separate run against the real model when I choose to pay for it.

### 3:15–4:45 L2: the factory (Phase 3, two jobs in parallel)

> "When the spec is clear I hand it to the factory. I label GitHub issues `factory` and type `/factory run`. Claude Code becomes the orchestrator; scripts own every state change, agents own every judgement."

On the **control room Board**: jobs 002 and 003 ran at the same time, each in its own git worktree, on its own ports.

The pipeline, per job:

```
intake → route (risk → which reviewers, which models) → planner → builder → gate
       → verifier + reviewers in parallel → approver (READY / ESCALATE) → PR + label factory:needs-human
```

Show PR #13 on GitHub: the factory's "ready for your review (you merge)" comment, with each acceptance criterion traced to a test and the verifier's screenshots inline. Then PR #7: there the approver said **ESCALATE**, because the job added a dependency (`zod` in the web app), and dependencies always need a human. Then in `factory/jobs/004-web-clearer-button-names/`: `intake.md`, `spec.md`, `plan.md`, `round-1/checks.md`, `round-1/review-*.md`, `decision.md`. Each starts with its verdict line.

Points to make:

- **Scripts own state.** `factory/bin/job` is the only writer of `job.json` and refuses illegal moves.
- **Risk routing.** `factory/config.json`: low risk gets haiku for the spec review, high risk adds an opus security reviewer.
- **Bounded.** At most 3 build rounds, then a person decides. It never merges.

### 4:45–5:45 L3: unattended (the ADWs)

> "Same roles, no Claude Code session at all. A Python pipeline calls `claude -p --agent <role>` for each step. I can start it from a terminal, or by commenting `adw` on an issue."

- `uv run adws/adw_sdlc_iso.py <issue>`: plan, build, test, review, in an isolated worktree under `trees/`.
- `adws/adw_triggers/trigger_cron.py` polls issues and answers **only the owner's** `adw` comment, so a stranger can't spend my subscription.
- Show PR #2 (the page footer): built end to end without me, then merged by me. Its files are in `agents/cf2c382c/`, the same contract files as the factory's.

> "Moving work along the dial changes no files. L1, L2 and L3 read the same agents, the same gate and the same guards."

### 5:45–7:00 What the harness learned

`docs/HARNESS_CHANGELOG.md` has 50 entries, each before → after → why. Pick three:

- **"The U+FFFD check in the gate never ran"** (2026-11-22): `--.` instead of `-- .` made git exit with an error, which the script read as "nothing found", so every gate passed the check without searching. A later review round caught it. Now the check fails closed: if it can't run, the gate fails. Lesson: test a new check against a known-bad input before trusting it.
- **"Phase 2 review round 1: three defense-in-depth gaps"** (2026-11-18): the tests passed, but the reviewers found that pointing the API at the database owner's login would have started cleanly and quietly switched RLS off for every tenant. Now the API refuses to start on a login that is a superuser, bypasses RLS or owns tables. Lesson: isolation that depends on configuration must check that configuration.
- **"Phase 5 CI dropped"** (2026-11-23): GitHub Actions couldn't run on my account, so the local gate stays the only gate. The design is kept in `docs/specs/ci-automated-review.md`. Honest trade-offs are part of the record.

Close:

> "The agents do most of the typing. The harness decides what they may do, proves their work with the same gate every time, and leaves a written trail from my intent to the merged PR. And only I merge."

## If something breaks live

- **Postgres not up:** `pnpm db:up` (Docker Desktop must be running).
- **The app won't load:** show the PRs and job folders instead; the trail is all in files.
- **The control room is empty:** `factory/bin/serve` reads `factory/jobs/` and `agents/`; run it from the repo root.
- **Asked to run the factory live:** a full job takes 20–40 minutes. Offer to start one at the beginning (`/factory run <n>` on a tiny issue) and check the board at the end.
