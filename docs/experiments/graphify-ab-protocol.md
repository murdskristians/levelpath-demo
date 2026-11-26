# Protocol: graphify A/B test on all three drivers

Fixed before the first run, so the result can't be chosen afterwards. Why this test exists: in [run 3](theme-toggle-graphify.md) graphify was installed but no agent ever queried it, so nothing was measured. The plan is [docs/plans/graphify-ab.md](../plans/graphify-ab.md).

Changed on 2026-11-26, before any run. Chris runs the three drivers by hand, the same way as runs 2 and 3. This replaces the earlier plan of six scripted L3 runs: there are now two batches of three, one run per driver in each.

## The one difference

Both sides use the same prompts, word for word: the planner and builder roles say "if `<main checkout>/graphify-out/graph.json` exists, find code with the graph first; otherwise Grep and Glob".

- **With:** `graphify-out/` is in the main checkout, rebuilt with `graphify update .` on the current `main`.
- **Without:** `graphify-out/` is moved out of the main checkout (to `agents/_experiments/graphify-out.off/`) for the whole batch. Without a graph, the role step falls back to Grep and Glob, and the graphify hooks print nothing.

The graphify CLI, its hooks, its CLAUDE.md section and its skill stay installed on both sides. The switch is per batch, because every agent of every driver reads the same main checkout.

**Graph use is enforced (since 2026-11-26).** The first "with" batch was invalid, because the role instruction alone wasn't enough: only one agent of the three drivers queried the graph. Now a hook in the planner's and builder's frontmatter, `.claude/hooks/graph_first.py`, blocks their first read or search of `apps/`, `packages/` or `db/` until they have run one `graphify query`, `explain` or `path`. Without a graph, the hook does nothing, so the prompts and hooks are still identical on both sides. Every block and query is logged to `graphify-out/graph-first.log.jsonl`.

## Held equal

| What    | How                                                                                                                                                                                                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task    | [`docs/intent/edit-draft-request.md`](../intent/edit-draft-request.md), word for word: names no files, crosses shared, API and web, no migration                                                                                                                                                                           |
| L3      | control room: paste the intent text into the Start run box, click Start run                                                                                                                                                                                                                                                |
| L2      | a new Claude Code tab on Sonnet: `/factory ` followed by the intent text                                                                                                                                                                                                                                                   |
| L1      | a new Claude Code tab on Sonnet, on a new `pair/edit-draft-request` branch: `/spec edit-draft-request`, `/plan edit-draft-request`, "approved, go ahead and build it", `/verify edit-draft-request`, `/review edit-draft-request`, and on CHANGES "yes, resume the builder for round 2" then `/verify` and `/review` again |
| Harness | `main` at the same commit for both batches                                                                                                                                                                                                                                                                                 |
| Models  | routed by `factory/config.json` from intake's risk; both chats on Sonnet                                                                                                                                                                                                                                                   |
| Start   | the same in both batches: L3, then L2 about 4 minutes later, then L1 about 8 minutes after L2                                                                                                                                                                                                                              |
| Order   | the "with" batch first. If it is invalid, the "without" batch isn't run                                                                                                                                                                                                                                                    |
| Between | each batch is cleaned up and archived before the next starts: PRs and issues closed unmerged, L1 kept as a patch                                                                                                                                                                                                           |

## Valid run

- **"With":** at least one `graphify query`, `explain`, `path` or `section` call by that driver's planner or builder.
- **"Without":** no graphify call at all.
- **Finished:** the run ends at READY or ESCALATE.

An invalid run is reported and repeated, never dropped silently.

## Measures

- **Primary, exploration:** input tokens and tool calls of the planner and the round-1 builder, plus the scout if it is routed. This is compared per driver: L1 with against L1 without, and so on.
- **Secondary:** total cost, wall time (and, for L1, Chris's waiting time, kept separate), rounds, Important findings, whether the gate passed on the first try, and acceptance criteria met.

## Verdict rule

- **Better:** exploration is at least 20% lower with graphify in **all three** drivers.
- **Worse:** at least 20% higher in all three.
- **No clear difference:** anything else, including a mixed result. That calls for more runs, not a conclusion.
- **Quality guard:** a saving doesn't count as better if the "with" batch has more rounds or more Important findings in total.

## Reporting

All six runs, valid or not, go in `docs/experiments/graphify-ab.md`. One run per driver per side is little: a clear verdict needs all three drivers to agree. Every run's PR is closed unmerged, so `main` never gets the feature.
