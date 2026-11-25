# Experiment run 3: theme toggle, three drivers, with graphify

The third run of the light/dark theme toggle. It is the **"with graphify" side** of the comparison with [run 2](theme-toggle-no-graphify.md). It used the same intent file, agents, routing, models and harness. The only change was [graphify](https://github.com/Graphify-Labs/graphify) 0.9.119 on `main`: the committed `graphify-out/graph.json`, the CLAUDE.md "graphify" rules, the advisory hooks and the allow rules (PR #26 and `ec3628e`).

Run on 2026-11-25. L1 and L3 finished with the approver's READY. L2 used up its three rounds and ended ESCALATE. Nothing was merged.

## Headline: no agent used graphify

Across all three drivers, **no agent and no chat ran `graphify query`, `explain`, `path` or `section` even once.** There was a single `graphify update .`, by L3's round-2 builder. It ran it because the spec reviewer cited the CLAUDE.md rule as a nit.

The agents did see graphify:

- every agent loaded the CLAUDE.md rules;
- the PreToolUse hook added its hint on every Read, Grep, Glob and Bash call: 24 times in L1's agents and 86 times in L2's;
- the L1 and L2 chats saw the hint too (11 and 16 times).

All of them ignored it. So **this run cannot measure what graphify does for the agents.** The differences from run 2 below are run-to-run variance, mostly from the number of rounds, plus graphify's small overhead in context.

Likely reasons:

1. **The task locates itself.** The intent names `apps/web/src/App.css`, and the change is a web-only stylesheet plus a hook. The planner found everything with 3 Greps and about 14 Reads, so there was nothing for a graph to find.
2. **The role prompts set the steps.** `.claude/agents/*.md` tell each role exactly what to read: the job folder, `git diff`, the spec. None of them mention graphify, and a rule in CLAUDE.md doesn't override a role's own procedure.
3. **Intake has no Bash**, so it can't run graphify at all.
4. **The orchestrators don't pass the rule on.** CLAUDE.md says to "put this rule in every subagent prompt that explores code". The skills build fixed prompt headers, so no orchestrator did.

## Inputs

|               | L1 pair                                     | L2 factory                         | L3 ADW                           |
| ------------- | ------------------------------------------- | ---------------------------------- | -------------------------------- |
| Started with  | `/spec theme-toggle` on `pair/theme-toggle` | `/factory` + the intent text (#28) | control room Start run box (#27) |
| Base commit   | `ec3628e` (main, graphify on)               | `ec3628e`                          | `ec3628e`                        |
| Chat model    | Sonnet 5.5                                  | Sonnet 5.5                         | none (Python)                    |
| Routed agents | low, `ui`; same models as run 2             | the same                           | the same                         |
| Ran (UTC)     | 17:41-22:00                                 | 17:40-19:45                        | 17:39-19:25                      |
| Result        | uncommitted, approver READY                 | PR #29, **ESCALATE** (rounds used) | PR #30, approver READY           |

**The start spacing was not kept.** All three started within two minutes (17:39, 17:40, 17:41). In run 2 L2 started about 4 minutes after L3, and L1 about 8 minutes after L2. So the machine was busier at the start than in run 2, which made problem 8 (runs collide) worse.

## Results, against run 2

|                             | L1 pair                                | L2 factory                         | L3 ADW                      |
| --------------------------- | -------------------------------------- | ---------------------------------- | --------------------------- |
| Cost, API-equivalent        | $3.20 → **$2.52**                      | $3.23 → $3.38 (board $2.92)        | $1.12 → $1.75               |
| of which chat               | $1.33 → $1.23                          | $1.01 → $1.32                      | $0                          |
| of which agents             | $1.87 → $1.29                          | $2.23 → $2.06                      | $1.12 → $1.75               |
| Build rounds                | 2 → **1**                              | 2 → 3 (limit)                      | 1 → 2                       |
| Wall clock                  | 2 h 57 → 4 h 18 min                    | 2 h 06 → 2 h 05 min                | 52 min → 1 h 45 min         |
| Machine time                | 81 → ~92 min                           | 2 h 06 → 2 h 05 min                | 52 min → 1 h 45 min         |
| Chris waiting               | ~94 → ~165 min (117 before `/review`)  | none                               | none                        |
| Gate durations (s)          | 697, 336 → 510 (+ 1 extra by the chat) | 536, 461 → 249 F, 1074 F, 638, 459 | 601 → 807, 660              |
| Important findings          | 2 → **0**                              | 2 → 3 (2 in round 2, 1 in round 3) | 0 → 1                       |
| Code lines, files (no docs) | 464, 7 → 398, 6 (220 + 178 tests)      | 450, 7 → 507, 6 (223 + 284)        | 507, 6 → 480, 6 (235 + 245) |
| Web tests added (main 86)   | 18 → 18                                | 18 → 55                            | 57 → 19                     |
| Plan lines                  | 105 → 82                               | 125 → 111                          | 137 → 81                    |
| graphify calls              | 0                                      | 0                                  | 1 `update`                  |

Totals: run 2 cost **$7.55**, run 3 **$7.65**. Each driver's cost follows its number of rounds, not graphify.

### What used the rounds

- **L1, 1 round.** Every reviewer passed in round 1. The builder reported READY, but its task then "stalled" ("API tests are just slow. Waiting."), so the chat ran the gate itself (about 11 minutes) before `/verify`. Chris's 2-hour pause before `/review` is most of the wall clock.
- **L2, 3 rounds, ESCALATE:**
  - **Round 1:** the gate failed on Prettier in the committed `docs/specs/006-…` and `docs/plans/006-…`. The builder said READY without a clean lint.
  - **Round 2:**
    - The builder fixed the formatting in 2.4 minutes.
    - The first gate then failed after **1074 s**, with API test hooks timing out under load. The orchestrator re-ran it on the same commit, which passed in 638 s.
    - The spec reviewer found two real issues: the dark `--border` at 2.48:1 against the 3:1 in the spec, and an edit to the root `CLAUDE.md` outside the scope.
  - **Round 3:** both were fixed. The spec reviewer then made the **comment-only `catch` blocks** Important. The plan chose them, and the bugs reviewer passed them: run 2's problem 3 again. No rounds were left, so `job advance` wrote ESCALATE and no approver ran. The open fix is three `console.warn` lines.
- **L3, 2 rounds.** In round 1 the Haiku spec reviewer made "criterion 10, the manual browser check, is not done" Important. The verifier was doing exactly that check in parallel and passed it. This is run 2's problem 4, and it cost a whole round: $0.75 and about 45 minutes. In run 2 L3 was the driver that avoided it.

## Per agent: input tokens (thousands) / tool calls

The table to compare with run 2's "What graphify could change". Run 2 values are on the left of each arrow.

| Agent            | L1                  | L2                               | L3                  |
| ---------------- | ------------------- | -------------------------------- | ------------------- |
| intake           | 56/5 → 60/7         | 62/6 → 67/7                      | 53/4 → 56/4         |
| planner          | 140/16 → **296/24** | 155/12 → **215/13**              | 173/11 → **266/14** |
| builder round 1  | 1378/38 → 1010/35   | 1319/37 → 1260/34                | 510/23 → 641/23     |
| verifier round 1 | 522/23 → 381/18     | 708/30 → none (gate failed)      | 430/18 → 227/11     |
| bugs round 1     | 91/6 → 96/8         | 96/6 → none                      | 74/5 → 63/4         |
| spec round 1     | 378/17 → 273/13     | 293/13 → none                    | 380/16 → 262/11     |
| builder round 2  | 592/11 → none       | 1480/49 → 185/4 (Prettier only)  | none → 998/32       |
| verifier round 2 | 333/17 → none       | 361/15 → 545/23                  | none → 295/15       |
| bugs round 2     | 77/5 → none         | 49/4 → 98/7                      | none → 85/7         |
| spec round 2     | 318/14 → none       | 307/14 → 326/14                  | none → 390/15       |
| builder round 3  |                     | none → 828/12                    |                     |
| verifier round 3 |                     | none → 406/18                    |                     |
| bugs / spec r3   |                     | none → 72/5, 298/14              |                     |
| approver         | 82/9 → 146/10       | 67/5 → none (ESCALATE by script) | 64/3 → 94/4         |
| chat             | 4311/32 → 2973/24   | 3251/34 → 4683/49                | none                |

- **Exploration got no cheaper.** The planners read 1.4-2.1 times as much as in run 2, in all three drivers, with no graphify calls. That looks like variance (more Reads), not the graph. The graphify text itself is small: the CLAUDE.md section is about 400 tokens per agent, and the hook adds about 60 per tool call.
- **The builders read about the same** (L1 −27%, L2 −4%, L3 +26%). L3 stays the cheapest builder. In both runs the L1 and L2 builders read about twice as much in round 1.

## Product

|                                                   | L1                                                    | L2                                         | L3                                                |
| ------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| OS default, toggle wins, no flash                 | yes                                                   | yes                                        | yes                                               |
| Stored in `levelpath.theme`, survives user switch | yes                                                   | yes                                        | yes                                               |
| Dark background                                   | `#111827`                                             | `#121212`                                  | `#111827`                                         |
| Lowest dark text contrast                         | 7.00:1                                                | 5.78:1                                     | 7.00:1                                            |
| Light theme unchanged against `main`              | yes (13 new layout lines)                             | yes (3)                                    | yes (3)                                           |
| Storage and `matchMedia` failures                 | **not caught in `theme.ts`** (the inline script logs) | **caught but silent** (the open Important) | caught and logged (`console.warn`)                |
| Extra files in the PR                             | none (pair run)                                       | none                                       | `graphify-out/graph.json`, `HARNESS_CHANGELOG.md` |

L1 and L3 picked the same dark palette, value for value, and both reach 7.00:1 at the lowest. On error handling, run 2 was better: all three logged storage failures then. This time L1's approver passed the missing `catch` as a nit, and L2 escalated over silent ones.

## Run 2's harness problems in this run

| #   | Problem                                    | Run 3                                                                                             |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1   | L3 approver didn't write `decision.md`     | did not recur (READY written and posted)                                                          |
| 2   | Job ids reused                             | avoided (job `006`, as planned)                                                                   |
| 3   | Planner writes a silent `catch`            | **recurred** in L2 and decided the ESCALATE; the bugs reviewer passed it again                    |
| 4   | Spec reviewer asks for the verifier's work | **recurred** in L3 round 1 (a whole round); L2's spec reviewer deferred it correctly              |
| 5   | L1 spec reviewer and uncommitted files     | did not recur                                                                                     |
| 6   | L3 verifier PASS with the API down         | did not recur (the API answered; 6 screenshots)                                                   |
| 7   | `port stop` leaves a booting server        | **recurred**: L1's API was still on 5090 after the run (I stopped it)                             |
| 8   | Concurrent runs collide                    | **worse**: an L2 gate failed on timeouts after 1074 s, and the L1 builder "stalled" on slow tests |

## New problems

9. **The L2 orchestrator re-ran a failed gate on its own.** It said "as the skill allows", but the factory skill says a FAIL goes back to the builder. The re-run was the right call for an infrastructure failure, but the skill should say when it is allowed.
10. **Wasted rounds count toward the limit.** L2's three rounds were Prettier on the docs, then two real findings, then one three-line fix. The limit was hit on a trivial finding, with no approver. Fix: the builder runs `pnpm lint` before READY. Also consider not counting a gate-only round.
11. **Builders "stall" after handing back.** The L1 builder handed back READY and kept waiting on a test run, and L2's round-2 builder needed a "handback-send-enforce" nudge and was stopped as stalled. The L1 chat then ran an extra gate.
12. **The graphify rule causes PR noise.** L3's spec reviewer asked for `graphify update .` from CLAUDE.md, so the PR carries a rewritten `graph.json`. Concurrent builders updating the shared graph in the main checkout would also collide.

## What this means for graphify

As installed (CLAUDE.md rules plus advisory hooks), graphify **changed nothing measurable**: zero queries, the same total cost ($7.55 → $7.65), and quality and time driven by rounds and machine load. It added about 400 tokens of rules to every agent, a hint on every tool call, and one graph rebuild in a PR.

To test whether the graph itself helps, the agents have to use it. Two ways, each a deliberate change to the protocol:

- **Make the roles use it:** add a step to `planner.md`, `builder.md` and `scout.md`, for example "locate code with `graphify query` before Grep/Read". This changes the harness, so graphify would no longer be the only difference; run 2 would need re-running with the same step minus graphify, or the step accepted as part of "with graphify".
- **Use a task that needs finding code:** for example an API change that crosses modules. The theme toggle names its file in the intent, so a code graph has little to offer here.

## Where the results are kept

- L1 code: uncommitted on `pair/theme-toggle` in the main checkout.
- L2: PR #29 (`factory/006-add-a-light-dark`), job folder `factory/jobs/006-add-a-light-dark/`.
- L3: PR #30 (`adw/c58bb65a-intent-light-dark-theme`), `agents/c58bb65a/`.
- None of them merged; not archived yet.

## How it was measured

- Agent cost, tokens and tool calls: the transcripts, priced with `factory/config.json`, by `agents/_experiments/runs3.py`.
  - L1 session `6e238b89`, L2 session `69bb6a89`, L3 `agents/c58bb65a/logs/`.
  - Resumed builders are split at each new prompt.
  - Duration counts only the agent's own turns.
  - `runs3.py run2` re-measures run 2 the same way.
  - L3's cost is `adw_state.json` `costs`, as in run 2.
- graphify use: Bash commands matching `graphify query|path|explain|section|update` in every transcript. Hook hints are counted by their text.
- Contrast and light fidelity: `agents/_experiments/css5.py` (run 2's `css4.py` on the run-3 branches).
