# Protocol: graphify A/B test on L3

Fixed before the first run, so the result can't be chosen afterwards. Why this test exists: in [run 3](theme-toggle-graphify.md) graphify was installed but no agent ever queried it, so nothing was measured. The plan is [docs/plans/graphify-ab.md](../plans/graphify-ab.md).

## The one difference

Both sides use the same prompts, word for word: the planner and builder roles say "if `<main checkout>/graphify-out/graph.json` exists, find code with the graph first; otherwise Grep and Glob".

- **With:** `graphify update .` in the main checkout before the run, so the graph exists and describes `main`.
- **Without:** `graphify-out/` moved out of the main checkout (to `agents/_experiments/graphify-out.off/`) for the run. Without a graph, the role step falls back to Grep and Glob, and the graphify hooks print nothing.

The graphify CLI, its hooks, its CLAUDE.md section and its skill stay installed on both sides.

## Held equal

| What    | How                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Driver  | L3 only: `uv run adws/adw_sdlc_iso.py <issue>`                                                                                                       |
| Task    | one new intent written for this test with `/intent`: it names no files, crosses `packages/shared`, `apps/api` and `apps/web`, and needs no migration |
| Input   | a fresh issue per run, its body the intent file, word for word                                                                                       |
| Harness | `main` after the PR that adds the "Finding code" step and the three fixes                                                                            |
| Models  | routed by `factory/config.json` from intake's risk, as always                                                                                        |
| Machine | one run at a time, nothing else running, Postgres up                                                                                                 |
| Order   | ABBA: with, without, without, with, with, without                                                                                                    |

## Valid run

- "With": at least one `graphify query`, `explain`, `path` or `section` call by an agent.
- "Without": no graphify call at all.
- The run ends at `needs-human` (READY or ESCALATE).

An invalid run is reported and repeated, never dropped silently. If the first run (with) is invalid, the test stops for a rethink.

## Measures

- **Primary, exploration:** input tokens and tool calls of the planner and the round-1 builder (plus the scout, if routed).
- **Secondary:** total cost, wall time, rounds, Important findings, gate passed on the first try, acceptance criteria met.

## Verdict rule

- **Better:** the "with" mean of the primary measure is at least 20% lower than the "without" mean, **and** every "with" run is below every "without" run.
- **Worse:** the same, the other way round.
- **No clear difference:** anything else. The next step is then more runs, not a conclusion.
- **Quality guard:** a saving doesn't count as better if the "with" side averages more rounds or more Important findings.

## Reporting

All six runs, valid or not, in `docs/experiments/graphify-ab.md`. The result holds for headless L3 runs on this kind of task, not for L1 or L2. Every run's PR is closed unmerged, so `main` never gets the feature.
