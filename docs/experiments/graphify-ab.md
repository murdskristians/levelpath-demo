# Results: graphify A/B test on all three drivers

The rules were fixed before the first run in [the protocol](graphify-ab-protocol.md). The task was [`edit-draft-request`](../intent/edit-draft-request.md), and Chris ran each driver by hand. The only difference between the two sides was whether the code graph (`graphify-out/`) was in the main checkout. With it, the `graph_first` hook made every planner and builder query it before reading code.

## Verdict: no clear difference

Exploration (the input tokens and tool calls of the planner and the round-1 builder) wasn't 20% lower with the graph in any driver. The protocol needs all three, so the verdict is **no clear difference**. Quality was the same on both sides: one build round, no Important findings, and every reviewer passed.

On a repo this small, the graph doesn't measurably change exploration. The agents already find the code in a few Grep and Read calls. The graph's answers are long, so they add about as many tokens as the reads they save. The one consistent signal: **planners made 11 to 20% fewer tool calls** with the graph.

L3 later got a second "with" run (batch 5, below). On its own it saved 17% of exploration tokens; averaged with the first, the saving is 6%. The planned second "without" run was skipped, so L3 has two runs with the graph and one without. The verdict stays the same, because L1 and L2 are at −7%.

## Before → after → improvement

Before means without the graph (batch 3). After means with the graph (batch 4). Both batches ran on `main` at `8ad0529` plus the risk pin, with Sonnet for every planner and builder, no scout, and four Sonnet reviewers. A negative change is better.

### Exploration (the primary measure)

| Driver     | Input tokens: before | after      | change    | Tool calls: before | after   | change    |
| ---------- | -------------------- | ---------- | --------- | ------------------ | ------- | --------- |
| L1 pair    | 1,257k               | 1,167k     | −7.2%     | 57                 | 59      | +3.5%     |
| L2 factory | 2,158k               | 2,004k     | −7.1%     | 74                 | 70      | −5.4%     |
| L3 ADW     | 1,535k               | 1,621k     | +5.6%     | 81                 | 73      | −9.9%     |
| **Total**  | **4,950k**           | **4,792k** | **−3.2%** | **212**            | **202** | **−4.7%** |

### Planner only (where finding code happens)

| Driver    | Tool calls: before | after  | change   | Input tokens: before | after    | change   |
| --------- | ------------------ | ------ | -------- | -------------------- | -------- | -------- |
| L1        | 9                  | 8      | −11%     | 153k                 | 209k     | +37%     |
| L2        | 20                 | 16     | −20%     | 254k                 | 297k     | +17%     |
| L3        | 26                 | 22     | −15%     | 416k                 | 403k     | −3%      |
| **Total** | **55**             | **46** | **−16%** | **823k**             | **909k** | **+10%** |

### Cost, time and quality

| Driver    | Run cost: before | after     | change    | Planner + builder time: before | after        | change   |
| --------- | ---------------- | --------- | --------- | ------------------------------ | ------------ | -------- |
| L1        | $2.59            | $2.61     | +0.8%     | 25.5 min                       | 23.1 min     | −9%      |
| L2        | $2.81            | $2.48     | −11.7%    | 27.4 min                       | 25.5 min     | −7%      |
| L3        | $1.82            | $1.96     | +7.7%     | 16.8 min                       | 29.5 min     | +76%     |
| **Total** | **$7.22**        | **$7.05** | **−2.4%** | **69.7 min**                   | **78.1 min** | **+12%** |

- **Run cost:** for L1 and L2 it includes the chat that drove the run.
- **Time:** the builder's time is mostly the gate (`pnpm test` against Postgres) and depends on what else was running, so it varies a lot between runs.

| Quality              | Before   | After                                |
| -------------------- | -------- | ------------------------------------ |
| Build rounds per run | 1, 1, 1  | 1, 1, 1                              |
| Important findings   | 0        | 0                                    |
| Reviewer verdicts    | all PASS | all PASS                             |
| Approver's decision  | READY ×3 | READY ×3 in substance (see the note) |

**Note on two ESCALATEs in the "after" batch:**

- **L1:** `/review` ran before `/verify`, so the approver had no verifier review and escalated. `/verify` ran afterwards and passed.
- **L3:** the approver answered READY but didn't write `decision.md`, so the ADW recorded ESCALATE. This happened in batch 2 as well; it is a harness bug, not a finding about the code.

## L3: a second run with the graph (batch 5)

L3's exploration rose in batch 4. The cause was the builder taking 22 model turns instead of 18: it ran fewer tool calls side by side, while reading 10% less. Every turn re-sends the whole context, so the extra turns added more tokens than the smaller reads saved. That is run-to-run noise, so the [protocol](graphify-ab-protocol.md) added one more L3 run per side before running it, with both runs counting. The "with" run was done (`524be108`, READY in one round, every reviewer PASS, both agents queried). The "without" run was skipped when Chris ended the test.

| L3                     | Without (batch 3) | With, batch 4 | With, batch 5 | With, average | Change (average) |
| ---------------------- | ----------------- | ------------- | ------------- | ------------- | ---------------- |
| Exploration tokens     | 1,535k            | 1,621k        | 1,276k        | 1,449k        | −5.6%            |
| Exploration tool calls | 81                | 73            | 68            | 70.5          | −13.0%           |
| Planner tool calls     | 26                | 22            | 18            | 20            | −23%             |
| Planner + builder time | 16.8 min          | 29.5 min      | 11.7 min      | 20.6 min      | +23%             |
| Agent cost             | $1.82             | $1.96         | $1.71         | $1.84         | +1%              |

### All drivers, using batch 5 for L3

This table puts L3's batch 5 run in place of batch 4. It is the more favourable of the two L3 runs, so always show it with that label and next to the average above.

| Measure                | L1    | L2     | L3 (batch 5) | Total      |
| ---------------------- | ----- | ------ | ------------ | ---------- |
| Exploration tokens     | −7.2% | −7.1%  | −16.9%       | **−10.2%** |
| Exploration tool calls | +3.5% | −5.4%  | −16.0%       | **−7.1%**  |
| Planner tool calls     | −11%  | −20%   | −31%         | **−24%**   |
| Planner tokens         | +37%  | +17%   | −44%         | **−10%**   |
| Run cost               | +0.8% | −11.7% | −6.0%        | **−5.8%**  |
| Planner + builder time | −9%   | −7%    | −30%         | **−13.5%** |
| Rounds, Important      | same  | same   | same         | same       |

## All batches

| Batch | Side    | Runs (L1 / L2 / L3)                                   | Valid? | Why                                                                                                     |
| ----- | ------- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 1     | with    | session 82461854 / job 007, PR #34 / b0697309, PR #35 | no     | the graph was queried once in total: an instruction alone didn't make agents use it                     |
| 2     | with    | session 76f7f4b5 / job 008, PR #40 / ac060a06, PR #39 | no     | each agent queried, but intake rated L1 and L2 high risk: Opus and a scout, so not comparable           |
| 3     | without | session 82bfab4a / job 009, PR #44 / b4d95c7b, PR #43 | yes    | all medium risk. Three agents ran `graphify query` and got "graph file not found": no graph information |
| 4     | with    | session 1296d26a / job 010, PR #48 / c3a08204, PR #47 | yes    | risk pinned to medium; every planner and builder queried (hook log in the archive)                      |
| 5     | with    | L3 only: 524be108, PR #50                             | yes    | extra L3 run, risk pinned; planner and builder queried. Its "without" pair was skipped                  |

- **Archives:** every batch is in `agents/_archive/ab<n>-…/` (git-ignored), with L1's code as a patch, and is measured with `agents/_experiments/runs3.py` (`ab-with`, `ab-with2`, `ab-without`, `ab-with3`, `ab-l3-with5`).
- **Tags:** the L2 and L3 branches are kept as `ab<n>/edit-draft-l2` and `-l3`.
- **No PR was merged.**

## What would show a difference

- **A larger codebase,** where finding the code costs real exploration. In this repo the planner reads 5 to 15 files.
- **Tasks that cross modules nobody names,** for example a bug report that only describes the symptom.
- **More runs per side.** One run per driver can't separate a 7% change from run-to-run noise.
