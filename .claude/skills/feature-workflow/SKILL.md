---
name: feature-workflow
description: The intent → spec → plan → build → verify → review loop of this repo and its three drivers (L1 pair with /intent /spec /plan /verify /review, L2 /factory run, L3 headless ADWs), where every artifact lives, and how a change ends (a PR only Chris merges). Use when starting any feature, bug fix or chore, when choosing how to run it, or when asked where a spec, plan, review or run state is.
---

# Feature workflow

Every change goes through the same steps and the same files. Only the driver,
the one who orchestrates, changes. The roles (`.claude/agents/`), the gate
(`factory/checks.sh`), the guards (`.claude/hooks/guard.py`) and the review
rules (`REVIEW.md`) are shared.

```
intent → spec → plan → build → gate → verify + review → PR → Chris merges
```

## Pick a driver: the autonomy dial

| Driver | You run | Use it when | Orchestrator |
| --- | --- | --- | --- |
| **L1 pair** | `/intent` → `/spec` → `/plan` → the `builder` agent builds → `/verify` → `/review` | High risk or new to you: RLS, auth, the LLM call. You approve each step. | You |
| **L2 supervised** | `/intent` → issue labelled `factory` → `/factory run <n>` | Several independent jobs at once, with intake, routing and the dashboard. | The `factory` skill in your session |
| **L3 unattended** | an issue, then comment `adw` (trigger running) or `uv run adws/adw_sdlc_iso.py <n>` | Well-scoped work with no session open. | Python (`adws/`) |

**Watch any of them** in the control room: `factory/bin/serve`, then http://127.0.0.1:8000. The Board shows every run's progress; the Agents tab shows each agent's actions live, plus the orchestrator. Its prompt box starts an L3 run.

## Where things live

| What | L1 | L2 | L3 |
| --- | --- | --- | --- |
| Intent | `docs/intent/<slug>.md` | the GitHub issue | the GitHub issue |
| Job folder (all role files) | `agents/<slug>/` | `factory/jobs/<id>/` | `agents/<adw_id>/` |
| Spec and plan | `docs/specs/<slug>.md`, `docs/plans/<slug>.md` | job folder, committed to `docs/` by the builder | same as L2 |
| Code | your branch | `.worktrees/<id>/` on `factory/<id>` | `trees/<adw_id>/` on `adw/<adw_id>-<slug>` |
| State | - | `job.json` (only `factory/bin/job` writes it) | `adw_state.json` |

The role files are the same everywhere: `intake.md`, `scout.md`, `spec.md`,
`plan.md`, `build.md`, `round-N/checks.md`, `round-N/review-<pass>.md`,
`decision.md`. Each starts with a `KEY: value` line that the drivers read.

## Rules that hold in every driver

- **Plan before code.** No code before the plan is approved (L1), or before
  `spec.md` and `plan.md` exist (L2, L3).
- **Bug runs lock the tests.** In L1, `/plan` writes `.claude/task-type`; in
  L2 and L3, intake's `TYPE: bug` does it. Tests that exist on `main` can't be
  edited; the fix goes in the code, with a new regression test.
- **The gate decides "it works"**, before any reviewer runs.
- **Reviews follow `REVIEW.md`.** An Important finding sends the work back.
- **It ends with a PR that only Chris merges.** Run it with `/try <pr>`
  first. No agent can merge, approve or push to `main`; the guard blocks it.
- **Afterwards:** a corrected mistake goes in `docs/HARNESS_CHANGELOG.md`, a
  new concept in `docs/LEARNING.md`.
