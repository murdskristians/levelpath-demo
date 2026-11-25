# Protocol: the same feature on every driver, without and with graphify

Six runs of one feature, the light/dark theme toggle: L1, L2 and L3 without graphify, then the same three with [graphify](https://github.com/Graphify-Labs/graphify). The only thing that changes between the two batches is graphify. Inside a batch, only the driver changes.

The earlier, unequal comparison is in [theme-toggle-baseline.md](theme-toggle-baseline.md). There L1 got the intent document while L2 and L3 got one sentence, so their planners guessed; these runs remove that difference.

## Held equal in all six runs

|                          | How                                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input                    | The text of [`docs/intent/theme-toggle.md`](../intent/theme-toggle.md), word for word: the issue body for L2 and L3, the intent file for L1.                                                                      |
| App code they start from | `main` with the harness fixes merged: L2 and L3 branch from `origin/main`, L1 from local `main`. The app code is the same as the baseline's (`2f875de`).                                                          |
| Harness                  | `main`, checked out in the main checkout for every run: all agents read their roles, hooks and scripts from it. Graphify, for the second batch, is added on top and is the only change.                           |
| Agents and prompts       | intake → route → planner (spec and plan in one call) → builder → gate → verifier and routed reviewers → approver, with the factory's prompts. L1's `/spec`, `/plan`, `/verify` and `/review` run the same agents. |
| Models                   | From `factory/config.json` routing, by intake's risk. For low risk: Sonnet planner, builder, verifier and bugs reviewer; Haiku spec reviewer. Intake and approver: Sonnet.                                        |
| Rounds                   | At most 3. Every Important finding goes back to the builder.                                                                                                                                                      |
| Machine                  | One run at a time, nothing else running, Postgres up (`pnpm db:up`).                                                                                                                                              |

## What Chris does in L1, to stay equal

- `/spec theme-toggle` (not `/intent`: the intent is fixed). Accept the spec as it is.
- `/plan theme-toggle`: approve with "approved", nothing more.
- `/verify theme-toggle`, `/review theme-toggle`. On CHANGES, have the builder fix every Important finding, as L2 and L3 do.
- Keep the chat on the same model in both batches.

## Starting each run

- **L3:** `uv run adws/adw_sdlc_iso.py <issue>` on an issue whose body is the intent file (no `factory` label).
- **L2:** `/factory run <issue>` on an issue with the same body and the `factory` label.
- **L1:** as above, on a branch made from `main`.

Issue title for both: "Add a light/dark theme toggle to the header".

## Measured

Per run: wall time and active time, cost (agents and orchestrator chat), tokens, tool calls per agent (Read, Grep, Glob, Bash, and graphify queries in the second batch), rounds, findings, gate time, files and lines changed, tests added, contrast and light-theme fidelity, what was checked in a browser. Same scripts as the baseline (`agents/_experiments/`).
