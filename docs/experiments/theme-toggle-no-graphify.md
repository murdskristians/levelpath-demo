# Experiment run 2: theme toggle, three drivers, without graphify

The second run of the light/dark theme toggle with all three drivers, after the twelve harness fixes from the [baseline](theme-toggle-baseline.md) (PR #21). This time every driver got the same input (`docs/intent/theme-toggle.md`) and the same agents and routing. This run is the **"without graphify" side** of the comparison: the next run repeats it with [graphify](https://github.com/Graphify-Labs/graphify) installed and nothing else changed. The protocol is in [theme-toggle-graphify-protocol.md](theme-toggle-graphify-protocol.md).

Run on 2026-11-25. All three finished with the approver's READY. Nothing was merged.

## Inputs

|               | L1 pair                                                                             | L2 factory                               | L3 ADW                                                                         |
| ------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| Started with  | `/spec theme-toggle` on `pair/theme-toggle`                                         | `/factory` + the intent text (issue #23) | control room Start run box, the intent text (#22)                              |
| Input text    | `docs/intent/theme-toggle.md`                                                       | the same text (+1 trailing blank line)   | the same text, identical                                                       |
| Base commit   | `2dcac7f` (main)                                                                    | `2dcac7f`                                | `2dcac7f`                                                                      |
| Chat model    | Sonnet 5.5                                                                          | Sonnet 5.5 (orchestrator)                | none (Python)                                                                  |
| Routed agents | intake → low, `ui`; planner and builder Sonnet; verify, bugs (Sonnet), spec (Haiku) | the same                                 | the same                                                                       |
| Ran (UTC)     | 11:39-14:37                                                                         | 11:31-13:39                              | 11:27-12:20                                                                    |
| Result        | uncommitted on `pair/theme-toggle`, approver READY                                  | PR #25, approver READY                   | PR #24, approver READY in its reply, but posted as "needs a human" (problem 1) |

**The runs overlapped.** From 11:39 to 12:20 all three ran at once, and L1 and L2 until 13:39; only L1's round 2 ran alone. The protocol asked for one at a time. Overlap roughly doubles the times: L1's gate took **697 s** in round 1 (three runs busy) and **336 s** in round 2 (alone) on almost the same code. The graphify run must be started the same way (L3, L2 a few minutes later, then L1) for the times to compare.

## Results

|                                     | L1 pair                                                                                          | L2 factory                                                      | L3 ADW                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------ |
| Wall clock                          | 2 h 57 min                                                                                       | 2 h 06 min (12 min lost to a PR mix-up, problem 2)              | **52 min**                                 |
| Machine time (agents + gate)        | 81 min                                                                                           | 2 h 06 min                                                      | **52 min**                                 |
| Chris waiting and reading           | ~94 min (between commands)                                                                       | none                                                            | none                                       |
| Cost, API-equivalent                | $3.20                                                                                            | $3.23 ($3.01 on the board, see below)                           | **$1.12**                                  |
| of which chat / orchestrator        | $1.33 (Sonnet, 50 turns)                                                                         | $1.01 whole chat, $0.78 inside the job's window                 | $0                                         |
| of which agents                     | $1.87 (11 calls)                                                                                 | $2.23 (12 calls)                                                | $1.12 (7 calls)                            |
| Chris's input                       | 6 commands, 2 replies ("approved, go ahead and build it", "yes, resume the builder for round 2") | 1 message (the intent text)                                     | 1 paste and a click                        |
| Build rounds                        | 2                                                                                                | 2                                                               | **1**                                      |
| Important findings in review        | 2 in round 1 (1 real, 1 false: problem 5), 0 in round 2                                          | 2 in round 1 (1 real, 1 redundant: problems 3, 4), 0 in round 2 | **0**                                      |
| Spec items / plan lines             | 21 / 105                                                                                         | 19 / 125                                                        | 18 / 137                                   |
| Code lines changed, files (no docs) | 464, 7 (227 code + 237 tests)                                                                    | 450, 7 (239 + 211)                                              | 507, 6 (225 + 282) + 1 line in `CLAUDE.md` |
| Tests added (web total, main 86)    | 18 (104)                                                                                         | 18 (104)                                                        | 57 (143; 41 are contrast pairs)            |
| Gate (`checks.sh`) duration         | 697 s, 336 s                                                                                     | 536 s, 461 s                                                    | 601 s                                      |
| Full test-suite runs                | 4 (builder 2, gate 2)                                                                            | 5 (builder 1 + 2, gate 2)                                       | **2** (builder 1, gate 1)                  |

### Time, step by step (minutes)

- **L1 round 1:** intake 1.5, planner 3.5 (spec and plan in one call); Chris read and approved after 6; builder 29.8; Chris started `/verify` 16 later; gate 11.6; verifier 11.5; Chris started `/review` 28 later; bugs and spec reviewers 5.5 → CHANGES.
- **L1 round 2:** Chris answered 36 later; builder 6.4; gate 5.6; verifier 3.5; reviewers 1.4; approver 0.7 → READY. (Chris ran `/verify` once more at 15:29 on the unchanged tree, `round-3/`; that is not part of the run and is not counted.)
- **L2:** intake 1.1, planner 3.0, builder round 1 36.5, PR mix-up 12 (problem 2), gate 9, reviews 12.6, builder round 2 29.2, gate 7.7, reviews 8, approver 1.2, hand-over 1.3.
- **L3:** intake 2, planner 2.7, builder 17.4, gate 10, reviews 13.8 (Haiku spec reviewer 12, verifier 12.7), approver 2.9, hand-over 2.5.

L1 and L2 now cost the same: the pair chat and the factory orchestrator are both Sonnet chats that mostly wait on agents. L3 does the same work for a third of the price, because it has no chat and needed one round.

## Product: the three now agree

The same intent file fixed the decisions that split the baseline (flash, label, where the choice is kept), so the three products behave the same. Only the palette and the button's look differ.

|                                                                          | L1                                                                              | L2                                                       | L3                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| First visit follows the OS, the toggle overrides                         | yes                                                                             | yes                                                      | yes                                     |
| No flash on reload (inline script in `<head>`)                           | yes                                                                             | yes                                                      | yes                                     |
| Follows OS changes live                                                  | no (assumption, stated)                                                         | no                                                       | no (assumption, stated)                 |
| Kept in `localStorage` `levelpath.theme`, survives a user switch, tested | yes                                                                             | yes                                                      | yes                                     |
| Invalid stored value ignored                                             | yes                                                                             | yes                                                      | yes                                     |
| Storage read and write failures logged, tested                           | both (read test added in round 2)                                               | both                                                     | both (`console.warn`)                   |
| Button label                                                             | "Switch to light/dark theme"                                                    | the same, with a ☀️/🌙 icon (`aria-hidden`)              | the same                                |
| Button style and place                                                   | outlined (secondary), own row under the picker, stray margin removed in round 2 | outlined, **beside** the picker, wraps on narrow screens | filled blue (primary), under the picker |
| Dark background                                                          | `#111827` grey-blue                                                             | `#0f1115` near-black                                     | `#0f172a` navy                          |
| Lowest dark text contrast                                                | 5.78:1                                                                          | 6.11:1                                                   | 5.76:1                                  |
| Light theme unchanged (against `main`)                                   | yes (only new layout rules)                                                     | yes (only new layout rules)                              | yes (only new layout rules)             |

All three pass WCAG AA for every dark text pair. L2's near-black and L3's navy repeat the baseline, which hints that the palette comes from the planner prompt, not chance.

## Code

|                                        | L1                                                              | L2                                                                                            | L3                                  |
| -------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------- |
| Structure                              | `useTheme` hook; React starts from the attribute the script set | helpers in `theme.ts`, state in `App` + `useLayoutEffect`, a `header-controls` wrapper        | the same as L2, without the wrapper |
| Rule in two places (script and TS)     | yes, "keep in step" comment and a text check                    | yes, comment and a test that runs the script                                                  | yes, comment and a test             |
| "Never silently fail"                  | kept                                                            | **broken in round 1** (2 empty `catch` in the script, copied from the plan), fixed in round 2 | kept                                |
| Write files with Write/Edit, pnpm only | builder used `printf` for `LEARNING.md`                         | builder used `sed -i` and `npx prettier`                                                      | kept                                |
| Open nits at the end                   | the script's `catch` has only a text check                      | test paths relative to the cwd                                                                | none                                |

## Evidence

|                              | L1                        | L2                                                      | L3                                                                    |
| ---------------------------- | ------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Final code seen in a browser | yes, in both rounds       | yes (round 2 verifier re-ran the browser: fix 3 worked) | **partly**: the API never answered on 9108, so no list, form or queue |
| Screenshots                  | 5 + 4 (no PR: pair run)   | 4 + 7, all 7 in the PR comment                          | 4 in the PR comment, one shows "Bad Gateway"                          |
| Light compared with `main`   | hex set diffed, identical | values asserted by a test                               | values asserted by a test                                             |
| Never checked                | throttled first paint     | a captured no-flash frame                               | every data screen; first paint                                        |

## The baseline's twelve fixes: did they work?

| #   | Fix                                                  | Result                                                                                                            |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Board cost includes the orchestrator                 | **worked**: "$2.23 agents + $0.78 chat"                                                                           |
| 2   | PR comment falls back to earlier shots               | worked (not needed: round 2 had shots)                                                                            |
| 3   | Verifier re-checks the browser when the page changed | **worked** (L1 and L2 round 2)                                                                                    |
| 4   | Gate keeps earlier runs                              | not exercised                                                                                                     |
| 5   | Spec assumptions reach "For the human"               | **worked** in L1 (5 quoted) and L2 (4); lost in L3 (problem 1)                                                    |
| 6   | Bugs reviewer flags empty `catch`                    | **failed**: L2's bugs reviewer saw both and excused them by the spec's wording; Haiku's spec reviewer caught them |
| 7   | Targeted checks in fix rounds                        | **mixed**: L1's round 2 builder ran no full suite; L2's ran `checks.sh` twice                                     |
| 8   | Write/Edit only, no shell writes                     | **partly failed**: `printf` (L1), `sed -i` and `npx` (L2)                                                         |
| 9   | Dev servers stopped after each step                  | L2, L3 clean; **L1 left its API on 5090 twice** (problem 7)                                                       |
| 10  | Gate records `+dirty` for uncommitted work           | **worked** (`2dcac7f…+dirty:…`, a new hash per round)                                                             |
| 11  | `/verify` stops first when Postgres is down          | not exercised                                                                                                     |
| 12  | L1 builds with the `builder` agent                   | **worked**: L1 cost $7.41 → $3.20 for two rounds                                                                  |

## Against the baseline

|                    | L1                                                   | L2                      | L3            |
| ------------------ | ---------------------------------------------------- | ----------------------- | ------------- |
| Cost               | $7.41 → **$3.20**                                    | $3.42 → $3.23           | $1.07 → $1.12 |
| Wall clock         | 21.5 h → 2 h 57 min                                  | 1 h 31 min → 2 h 06 min | 27 → 52 min   |
| Rounds             | 1 → 2                                                | 3 → 2                   | 1 → 1         |
| Products differ in | flash, label, layout → only palette and button style |                         |               |

L1 got cheaper because the builder agent replaced the Opus chat, and the chat is now Sonnet. L1 gained a round because its reviewers are now the same as L2's and L3's (in the baseline the Opus chat wrote the code and four reviewers found nothing). L2 and L3 slowed down mostly because the runs overlapped, and L2 also lost time to the PR mix-up.

## New harness problems

Not fixed yet on purpose: the graphify run must use the same harness as this one, or the difference is no longer graphify alone.

1. **The L3 approver didn't write `decision.md`.** It returned "READY …" as its reply, and the ADW then wrote "ESCALATE: the approver didn't write a READY or ESCALATE decision", so PR #24 says "needs a human" and lost its "For the human" list. Fix: the ADW takes the decision from the reply when the file is missing, or resumes the approver once.
2. **Job ids are reused.** Archiving the baseline's `005` folder let `job create` hand out `005` again, so the branch `factory/005-add-a-light-dark` was the one closed PR #19 had used. The builder took #19 for its PR, `advance gate` refused, the builder stalled for 10 minutes, and a second builder opened PR #25. Fix: `job create` skips an id whose branch or PR already exists. For the graphify run, keep `factory/jobs/005-…` in place so the next job is `006`.
3. **The planner put an empty `catch` in the plan** (L2 `plan.md` line 83), the same slip as the baseline's L1 plan, with spec text ("logs nothing silently") that let the bugs reviewer excuse it. Fix: the planner role checks its code sketches against CLAUDE.md's Rules.
4. **The spec reviewer asks for the verifier's work.** L2's round 1 Haiku reviewer made "the dark visual pass wasn't done" Important while the verifier was doing exactly that in parallel (and passed it). That cost round 2 its 29-minute builder. L1's and L3's spec reviewers left the same criterion to the verifier, as they should. Fix: in `reviewer-spec.md`, browser and manual criteria belong to the verifier, never a finding.
5. **L1's spec reviewer doesn't know a pair run is uncommitted.** It made "spec and plan are untracked" Important. Fix: `/review`'s prompt says "Pair run (L1): uncommitted by design", as `/plan`'s builder prompt already does.
6. **The L3 verifier passed with the API down.** Under load the API on 9108 never answered, so no data screen was seen, but the verdict was PASS and the approver said READY. Fix: when the app can't start, the verifier reports CHANGES ("not verified"), not PASS.
7. **`port stop` stops only listeners.** A dev server that is still booting survives and starts listening later: L1's API on 5090 was found running after round 1's builder and again after round 1's verifier. Fix: stop by process tree from the PID the agent started, or wait and retry.
8. **Concurrent runs collide.** Besides the doubled gate time, L2's builder saw a Postgres "terminating connection" failure in one test run while another run's tests were dropping their databases. Run one at a time, or accept it the same way in both runs.

## What graphify could change

graphify gives agents a code graph instead of grepping and reading files. If it helps, it shows up first in the agents that explore: their input tokens and tool calls. These are the numbers to beat (input tokens in thousands / tool calls):

| Agent            | L1        | L2                         | L3       |
| ---------------- | --------- | -------------------------- | -------- |
| intake           | 56 / 5    | 62 / 6                     | 53 / 4   |
| planner          | 140 / 16  | 155 / 12                   | 173 / 11 |
| builder round 1  | 1378 / 38 | 1319 / 37 (+68 / 5 PR fix) | 510 / 23 |
| verifier round 1 | 522 / 23  | 708 / 30                   | 430 / 18 |
| bugs round 1     | 91 / 6    | 96 / 6                     | 74 / 5   |
| spec round 1     | 378 / 17  | 293 / 13                   | 380 / 16 |
| builder round 2  | 592 / 11  | 1480 / 49                  | none     |
| verifier round 2 | 333 / 17  | 361 / 15                   | none     |
| bugs round 2     | 77 / 5    | 49 / 4                     | none     |
| spec round 2     | 318 / 14  | 307 / 14                   | none     |
| approver         | 82 / 9    | 67 / 5                     | 64 / 3   |
| chat             | 4311 / 32 | 3251 / 34                  | none     |

The same Sonnet builder read 2.7 times as much in L1 and L2 as in L3 for round 1. Also watch the quality side: rounds, Important findings and rule slips. Graphify can't fix the harness problems above, so those will recur and should be read as noise in the comparison.

## Where the results are kept

- L2 and L3 code: local tags `run2/theme-toggle-l2` (`9e76c21`) and `run2/theme-toggle-l3` (`bf3936b`). Their remote branches are deleted; PRs #24 and #25 and issues #22 and #23 are closed, unmerged.
- L1 code: `agents/_archive/run2-theme-toggle/l1-theme-toggle-code/l1.patch` (never committed; checked to apply cleanly to `2dcac7f` with `git apply`).
- Job folders: `agents/_archive/run2-theme-toggle/` (`l1-theme-toggle`, `l2-005-add-a-light-dark`, `l3-8e469b6a`). `factory/jobs/005-add-a-light-dark/` also stays in place, rejected, so the next factory job is `006` (problem 2).

## For the graphify run

- Hold constant: Sonnet in both chat tabs, the same start order and spacing, the same intent file, and in L1 the same replies (approve the plan; on CHANGES, "yes, resume the builder").

## How it was measured

- Agent cost, tokens and tool calls: each agent's transcript (`~/.claude/projects/<repo>/<session>/subagents/` for L1 and L2, `agents/_archive/run2-theme-toggle/l3-8e469b6a/logs/` for L3), priced with `factory/config.json`. Tool calls are counted once per call id (session transcripts store each call twice). L1's builder was resumed for round 2, so its transcript is split at 13:37 UTC. L3's total is the ADW's `adw_state.json` `costs`; L2's board figure is `factory/bin/job summary`.
- Timeline: the L1 and L2 chat transcripts (sessions `171ead3c` and `2df150f1`) and `agents/_archive/run2-theme-toggle/l3-8e469b6a/adw_sdlc_iso/execution.log`.
- Contrast and light-theme fidelity: `agents/_experiments/css4.py` (the baseline's `css3.py`, L1 read from the working tree). Costs: `agents/_experiments/runs2.py`.
