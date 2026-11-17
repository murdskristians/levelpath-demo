# Plan: Phase 1b, the control room

Status: **Done 2026-11-17.**

## Why

Phase 1 dropped tac-combined's web UI (a prompt box, and the orchestrator and every agent visible live) as one line of the plan, without asking. That was a mistake, logged in `docs/HARNESS_CHANGELOG.md`.

Chris wants three things:

- the same live experience;
- two views over **every** run, whichever driver started it: the agents at work, and the progress of tasks;
- **levelpath-demo to stand on its own**, with no code or settings from another project.

tac-combined is private course code (about 25,000 lines), and this repo is public. So the decision (Chris, 2026-11-17) was to **build our own UI here**, small and public, on the files every run already writes.

## What was built

**`factory/bin/serve`: the control room.** It is stdlib Python and reachable from this machine only. Open http://127.0.0.1:8000.

- **Board:** every run's stage, rounds, verdicts, PR and cost, with a driver badge.
  - `/factory run` jobs (`factory/jobs/<id>/`, badge **chat**).
  - ADW runs (`agents/<adw_id>/`, badge **ADW**), shaped like factory jobs, so one board renders both.
- **Agents:** a run's tab with each agent's actions live: what it says, every tool call and its result.
  - ADW agents come from their stream logs (`agents/<id>/logs/`).
  - `/factory run` subagents come from Claude Code's transcripts, found by the job header. Their `.meta.json` gives the role, model and whether the agent has finished.
  - The orchestrator's decisions come first: the ADW pipeline's log, or the lines of your `/factory` session that name the job.
- **Prompt box:** files the text as a GitHub issue and starts an unattended ADW run on it, detached so stopping the server never stops a run.
- **Feedback box:** for an ADW run waiting on you (`adw_patch_iso.py`). Factory jobs take feedback in the Claude session, as before.
- **Files:** each step's files, as before, now with the verifier's screenshots.
- **Safety:**
  - It binds `127.0.0.1` and refuses other `Host` headers (DNS rebinding).
  - It serves only the run folders: never the repo, so never `.env`.
  - Every POST needs an `X-Control-Room` header, which another site's page can't send.

**Standing alone:**

- `/orch_factory` (the command that lets tac-combined's UI drive this factory) moved into tac-combined's own toolkit. tac-combined still works with this repo, privately, and this repo doesn't need it.
- `CREDITS.md` no longer links to private repositories.

## Verification (done)

- **API, against the two real runs:**
  - factory job 001: 7 agents, 21 orchestrator events;
  - ADW run `ec19ba08`: 7 agents with model and cost, 23 orchestrator events;
  - each agent's event stream.
- **Protections:**
  - `/.env` → 404;
  - path traversal → 403;
  - a foreign `Host` → 403;
  - a POST without the header → 403;
  - an empty prompt → a clear error.
- **In a real browser (agent-browser), screenshots of:**
  - the Board with both runs;
  - the Agents tab of the ADW run (orchestrator log, 7 agents);
  - the factory builder's live events: a failing test, the fix, the passing run, the commit, the push.
- **A bug the browser check caught:** the feedback box showed on a merged run; fixed.
- **Script:** `node --check` passes on the page's script.
