---
name: orch_factory
description: For the tac-combined orchestrator UI. Run one GitHub issue (or a new feature description) through this repo's software factory with the same roles, the same factory/bin/job state machine and the same gate as /factory run, so every agent is visible in the UI and the job shows on the factory dashboard. Never merges.
argument-hint: <issue-number> | <feature description>
---

# Factory run, driven from the orchestrator UI

You are the orchestrator, running this repo's software factory for one issue.
The pipeline, the roles and the files are exactly those of `/factory run`
(`.claude/skills/factory/SKILL.md`); only how agents are started differs. You
start them with `create_agent`, give them work with `command_agent`, and wait
with `check_agent_status`, so each one appears in the UI.

The scripts in `factory/bin/` change the job's state and refuse illegal moves.
When one refuses, its message says why: fix the cause, or stop and tell the
user. Never work around it. **Never merge, approve or close a PR, and never
push to main:** a person merges every PR, and the guard hook blocks it anyway.

## Input

ARGUMENTS: $ARGUMENTS

- **A number:** that issue.
- **Text:** a new feature. Create the issue first, then use its number:
  `gh issue create --label factory --title "<short imperative title>" --body "<the text, verbatim>"`

## Setup

1. `factory/bin/job queue`. If it lists a job for the issue, resume it from its
   stage (see Resuming). Otherwise run `factory/bin/job create <n>`, which
   prints the job id.
2. Read `factory/jobs/<id>/job.json` with `cat` for `worktree`, `branch` and
   `agents`. The **header** that starts every agent prompt is:

   ```
   Job: <id>. Job folder: <repo>/factory/jobs/<id>/. Main checkout: <repo>. Worktree: <worktree>. Branch: <branch>. Base: origin/main. Issue: #<n>.
   ```

   `<repo>` is `git rev-parse --show-toplevel` with forward slashes. Keep
   `Job folder: <path>/` exactly as shown: the job's cost is found by that string.
3. **Ports,** for the builder and the verifier: with `k` the job number
   (`003` → 3), `Ports: API <5100 + 10k>, web <5101 + 10k>.`

## Agents

- Name each agent `<role>-<k>`, e.g. `intake-3`, `planner-3`, `builder-3`,
  `verifier-3`, `reviewer-bugs-3`.
- Create it with `create_agent(name, system_prompt="", subagent_template=<role>)`.
  Add `model` from `job.json` `agents` for the planner (`agents.planner`), the
  builder (`agents.builder`) and each reviewer (`agents.reviewers.<r>`).
- Never set `use_worktree`: the job already has its worktree.
- To wait: `Bash(sleep 15)`, then `check_agent_status(agent_name)`, repeated
  until you see a `response` followed by a `hook` with a `Stop` event.
- Then read the file the role wrote **by its first line only** (`head -1`). The
  detail in it is for the next agent and for the human, not for you.
- Leave every agent in place when you finish, for inspection.

## Steps

Report one short line per step, e.g.
`003 #12: gate PASS → reviewing (verify, bugs, spec)`.

1. **intake.** Create `intake-<k>` (template `intake`) and command it with
   `<header>`. Then read `head -1 factory/jobs/<id>/intake.md`:
   - `DECISION: ACCEPT`: run `factory/bin/route <id>`, then
     `factory/bin/job advance <id> spec`. That comments on the issue and
     creates the worktree; re-read `job.json` for the worktree path.
   - `DECISION: NEEDS-INFO`: run `factory/bin/job advance <id> needs-info`
     and stop. The question is on the issue.
   - `DECISION: REJECT`: run `factory/bin/job advance <id> rejected` and stop.
2. **spec.** If `job.json` `intake.risk` is `high`, first create `scout-<k>`
   (template `scout`) with `<header>` and wait for it. Then create `planner-<k>`
   (template `planner`, model `agents.planner`) with `<header>`. When both
   `spec.md` and `plan.md` exist, run `factory/bin/job advance <id> build`.
3. **build.** Round N. For round 1, create `builder-<k>` (template `builder`,
   model `agents.builder`). For later rounds, `command_agent` the same builder.
   The command is `<header> Build round <N>. Ports: API <a>, web <w>.` plus what
   the round is for:
   - the spec;
   - the gate's `round-<N-1>/checks.md`;
   - the reviews in `round-<N-1>/`;
   - a `feedback-<k>.md`.

   Then read `head -1 build.md`:
   - `STATUS: READY`: run `factory/bin/job advance <id> gate`. If it refuses
     (nothing pushed, no PR, a dirty tree), command the builder once with the
     refusal. If it refuses again, stop and report.
   - `STATUS: BLOCKED`: run `factory/bin/job advance <id> needs-human` and stop.
4. **gate.** Run `factory/bin/gate <id>`.
   - `GATE: PASS`: run `factory/bin/job advance <id> review`.
   - `GATE: FAIL`: run `factory/bin/job advance <id> build`, or `needs-human`
     when it refuses because this was the last round. Back to step 3, with
     the reason "the gate failed: read round-<N-1>/checks.md and checks.log".

   No reviewer runs on a failing build.
5. **review.** For every key `r` in `job.json` `agents.reviewers`, create
   `<agent>-<k>` with template `<agent>` and the routed model. `verify` uses
   the agent `verifier`; any other `r` uses `reviewer-<r>`. Command them all
   **before** waiting on any, so they run in parallel:
   `<header> Review round <N>.`, plus `Ports: API <a>, web <w>.` for the
   verifier. **Wait for all.** As each one finishes, run
   `factory/bin/job sync <id>` so the dashboard fills in.
   - **All PASS:** run `factory/bin/job advance <id> approve`.
   - **Any CHANGES:** run `factory/bin/job advance <id> build`, or `needs-human`
     on the last round, then step 3 with "Round <N-1> reviews are in
     round-<N-1>/. Address every Important finding, push, and update build.md".
6. **approve.** Create `approver-<k>` (template `approver`) with
   `<header> PR: #<pr>. Final round: <N>.` When it finishes, run
   `factory/bin/job advance <id> needs-human`, whatever `decision.md` says.
   That marks the PR ready, posts the decision on it and labels the issue
   `factory:needs-human`.

## Resuming

A job that `factory/bin/job queue` lists as `resume` continues from its stage:

- `intake` and `spec`: run their agents again.
- `build`: a new builder, told it is resuming. It reads `build.md` and
  `git log`.
- `gate`: run the gate.
- `review`: only the reviewers whose `review-<r>.md` is missing in the current
  round.
- `approve`: the approver.

## Report

When the job reaches `needs-human`, `needs-info` or `rejected`, finish with:

- `factory/bin/job summary <id>`: stage, PR, cost, time.
- `report_cost`.
- The PR link, and one line: "Chris reviews and merges the PR; run `/try <pr>`
  in Claude Code to check it locally."
