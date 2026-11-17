# Plan: Phase 1b, the orchestrator UI as a fourth driver, and one view of every run

Status: **Part A done 2026-11-17. Part B awaits Chris's approval.**

## Why

Phase 1 dropped tac-combined's web UI (API key, Neon, a third engine) as one line of the approved plan, without asking. That was a mistake, logged in `docs/HARNESS_CHANGELOG.md`. Chris wants all three ways of running work:

1. Claude chat + the factory dashboard.
2. tac-combined's UI: type a prompt, watch the orchestrator and every agent live.
3. An `adw` comment on an issue.

All three should use the same agents. Chris also wants two views (agents at work, and the progress of tasks) that show every run, whichever driver started it. The API key and Neon are fine.

## Part A: tac-combined drives the same factory (done)

- **`/orch_factory <issue | description>`** (in this repo's `.claude/commands/`, which tac-combined prefers over its own). The orchestrator runs the factory pipeline:
  - **State and gate:** it uses `factory/bin/job` for every state change and `factory/bin/gate` for the checks.
  - **Agents:** it creates each role with `create_agent(subagent_template=<role>)` and the routed model, so every agent appears in the UI.
  - **Same everywhere:** the job's files, the dashboard, the labels and the end are the same as `/factory run`. It never merges.
- **tac-combined** (Chris's repo):
  - The auto-merging `/orch_sdlc_zte` is removed.
  - The model aliases point at the current models (`sonnet` → `claude-sonnet-5-5`, `opus` → `claude-opus-5-5`, `haiku` → `claude-haiku-5-5`), so tac's agents run on the same models as the other drivers.
  - Its agents load this repo's settings (`setting_sources=["project"]`), so `guard.py` applies to them too.
- **Factory cost:** `job` now counts agents that are their own sessions (tac's), not only `/factory run` subagents. An unpriced model is a warning, never a stop. Factory script tests: 35/35.
- **Chris does:** put `ANTHROPIC_API_KEY` and `ORCHESTRATOR_WORKING_DIR=C:/dev/LevelPath/levelpath-demo` in `tac-combined/.env` (secrets stay out of the agents' hands; Neon's `DATABASE_URL` is already there). Then start the backend and frontend and type `/orch_factory <issue>`.

## Part B: two views, every driver (proposed)

**Progress board (the factory dashboard view)**, built from files every driver already writes:

- **B1.** ADW runs also write `agents/<id>/job.json` in the factory's job schema (plus `"driver": "adw"`), on every state save.
- **B2.** `factory/bin/dashboard`: a small server that only listens on localhost and serves `factory/` and the ADW run folders read-only. Today's `python3 -m http.server` would expose the whole repo, `.env` included, if run from the root. The dashboard shows factory jobs and ADW runs together, with a driver badge: chat, tac UI, or ADW.
- **B3.** tac UI gets a **Board** tab with the same columns and cards, read from the same files through a new backend endpoint.

**Agents view (tac's live view)**, for every driver:

- **B4.** A watcher in tac's backend follows the transcripts of agents it didn't start:
  - `/factory run` subagents: `~/.claude/projects/<repo>/<session>/subagents/*.jsonl`, matched to their job by the header's `Job folder:`.
  - ADW agents: `agents/<id>/logs/*.jsonl`.

  It records them in its agent and event tables under one "external run" per job, and pushes them to the live stream. Its own agents are already recorded, so nothing is doubled. AI summaries stay off for these events (no extra cost).

Then any run, started from the chat, the UI or a comment, shows on the board in both UIs and with its agents live in the tac UI.

**Effort:** B1 and B2 are small. B3 and B4 are about a session each in tac-combined's FastAPI and Vue code.

## Verification

- **Part A:** one `/orch_factory` run on a tiny issue from the tac UI, ending at `needs-human` with a PR. The job appears on the factory dashboard with its cost, and every agent appears in the UI.
- **Part B:** one run per driver appears on both boards; the agents of a `/factory run` and an ADW run stream live in the tac UI.
