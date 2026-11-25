# Experiment: one feature, three drivers (baseline, before graphify)

The same small feature, a light/dark theme toggle, built once by each driver of the harness (L1 pair, L2 factory, L3 ADW), to see how the drivers differ in time, cost, effort and quality. None of the three was merged: `main` stays without the toggle so the task can be run again. This is the **baseline**; the next run repeats it after adding [graphify](https://github.com/Graphify-Labs/graphify) and is compared against these numbers.

Runs: 2026-11-23 and 2026-11-24. One run per driver, so differences of a single run can be chance (see "Driver or chance").

## Inputs

|                    | L1 pair                                            | L2 factory                                       | L3 ADW                                                  |
| ------------------ | -------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| Started with       | `/intent light-dark theme toggle`                  | `/factory` with the issue text below (issue #18) | the control room's Start run box, same text (issue #15) |
| Base commit        | `2f875de`                                          | `7c68470`                                        | `7c68470`                                               |
| Who wrote the code | the pair chat itself (Opus 5.5)                    | `builder` agent (Sonnet 5.5)                     | `builder` agent (Sonnet 5.5)                            |
| Reviewers          | bugs, spec, security, verify (all Sonnet)          | verify, bugs (Sonnet), spec (Haiku)              | verify, bugs (Sonnet), spec (Haiku)                     |
| Result             | local commit `ef98625` on `pair/light-dark-toggle` | PR #19, approver READY                           | PR #16, approver READY                                  |

The issue text for L2 and L3:

> Add a light/dark theme toggle to the header. It switches the whole app between light and dark colours, remembers the choice after a reload, and starts with the system setting.

Chris's answers to `/intent` in L1 (give the same answers in a rerun):

1. First visit and toggle: **follow the OS, the toggle overrides it.**
2. Where the choice is kept: **per browser, `localStorage`.**
3. Done bar for dark: **every screen, readable** (WCAG AA).
4. Out of scope: **per-tenant branding, a redesign, a new UI library, a keyboard shortcut.**
5. Driver: **L1.** Plan approval: "approved, go with secondary" (the secondary button style).

## Results

|                                     | L1 pair                                                  | L2 factory                                | L3 ADW                     |
| ----------------------------------- | -------------------------------------------------------- | ----------------------------------------- | -------------------------- |
| Wall clock                          | 21.5 h (waits on Chris, includes a night)                | 1 h 31 min (+42 min failed first attempt) | **27 min**                 |
| Active time                         | ~73 min                                                  | 91 min                                    | **27 min**                 |
| Cost, API-equivalent                | $7.41                                                    | $3.42 ($4.27 with the failed attempt)     | **$1.07**                  |
| of which chat / orchestrator        | $6.53 (Opus pair chat, 70 turns, ~8.2M tokens)           | $1.17 (Opus orchestrator)                 | $0 (Python)                |
| of which agents                     | $0.89                                                    | $2.25 (13 calls)                          | $1.07 (7 calls)            |
| Chris's input                       | 5 commands, 5 answers, 2 short messages, starting Docker | 1 command (plus repairing attempt 1)      | **1 sentence and a click** |
| Build rounds                        | 1                                                        | 3 (the limit)                             | 1                          |
| Code findings in review             | **0**                                                    | 2 (a missing test; a real bug)            | 0                          |
| Spec items / plan lines             | 25 / 224                                                 | 17 / 84                                   | 16 / 73                    |
| Code lines changed, files (no docs) | ~437, 7                                                  | ~350, 7                                   | **~293, 5**                |
| Tests added (web total)             | 10 (96)                                                  | 11 (97)                                   | 8 (94)                     |
| Gate (`checks.sh`) duration         | 297 s                                                    | 455-555 s (busy machine)                  | 237 s                      |
| Full test-suite runs                | 3                                                        | 7                                         | 2                          |

### Time, step by step

- **L1:** `/intent` 8 min; `/spec` 1.3 min (Chris then read it for 20 min); `/plan` 4 min; build 28 min (code ~10 min, then `checks.sh` and a walk through every screen in Chrome); `/verify` the next evening 22 min (11 lost: Docker Desktop was not running, so round 1 failed); `/review` 1.5 min; nits and commit 2 min.
- **L2:** intake 1 min, planner 2, build round 1 21.5, gate 8.5, reviews 5; rounds 2 and 3 took 46 min for a one-test fix and a three-line script fix, about 17 min of each round being the full suite run twice (builder, then gate); approver 1.2.
- **L3:** intake 1.2, planner 1.7, builder 13.4, gate 4, reviews 4.7, approver 1.3, hand-over 0.5.

## Why they differ: who decided the scope

The request is vague about one thing: may the page flash the light theme while it loads?

- **L1:** Chris decided it in `/intent` (no flash; every screen AA, Suggest fields included; the theme survives a user switch). One rule slip in the plan (an empty `catch`) was fixed before any code. The reviewers found nothing in the code.
- **L2:** the planner chose "no flash" on its own. Two extra rounds: the spec reviewer (Haiku, $0.01 a round) found an untested requirement, then a real bug in the pre-paint script.
- **L3:** the planner chose "a flash is fine" and listed it as an assumption, which never reached the human's list.

The spec decided quality and cost; the driver decided how much of Chris it took.

## Product

|                                                | L1                                                          | L2               | L3                                                 |
| ---------------------------------------------- | ----------------------------------------------------------- | ---------------- | -------------------------------------------------- |
| No flash on reload                             | yes, also colours the canvas before the CSS loads           | yes              | **no**                                             |
| Follows OS changes live until a choice is made | yes (also notices a choice made in another tab)             | no               | no                                                 |
| Keeps the theme across a user switch           | yes, tested                                                 | yes, untested    | yes, untested                                      |
| Button                                         | "Switch to light/dark theme"                                | same             | "Dark theme" with `aria-pressed`, no visible state |
| Button position                                | beside the user picker, wraps on narrow screens             | under the picker | under the picker                                   |
| Dark style                                     | navy, filled inputs, saturated blue buttons with white text | near-black, flat | navy, lighter inputs                               |
| Lowest dark text contrast                      | 5.17:1                                                      | 5.78:1           | 5.77:1                                             |
| Light theme unchanged (checked against `main`) | yes                                                         | yes              | yes                                                |

All three pass WCAG AA for every dark text pair.

## Code

|                                   | L1                                                                                      | L2                                                             | L3                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| Structure                         | `theme.ts` rules, `useTheme` hook, inline script; React starts from what the script set | state in `App`, a prop drilled into `Dashboard`, inline script | one hook; toggle inside the existing `picker` fragment |
| Theme rule in two places          | yes, comment only                                                                       | yes, a keyword test                                            | no                                                     |
| "Never silently fail" (CLAUDE.md) | kept                                                                                    | **3 empty catches**                                            | kept                                                   |
| pnpm only, no shell file writes   | kept                                                                                    | shell writes                                                   | `npx`, shell writes                                    |

## Evidence

|                              | L1                                                      | L2                                  | L3                     |
| ---------------------------- | ------------------------------------------------------- | ----------------------------------- | ---------------------- |
| Final code seen in a browser | yes                                                     | **no** (only round 1)               | yes                    |
| Screenshots                  | 3 (form with Suggest fields, error alert, empty header) | 2, none in the PR comment           | 4, 3 in the PR comment |
| Never checked                | throttled reload for a flash; light form at phone width | the final no-flash fix; phone width | (flash accepted)       |

## Driver or chance

- **From the driver:** L1 lets Chris set the scope, writes the code in the chat and costs what the chat's length costs. L2 pays for an orchestrator chat, needs an open tab and is subject to the auto-mode permission classifier (which killed attempt 1). L3 runs unattended, is cheapest and leaves its trail on GitHub.
- **From the setup:** L1 coded with Opus, L2 and L3 with Sonnet; L1 ran four Sonnet reviewers, L2 and L3 three with a Haiku spec reviewer.
- **Chance:** the palettes, the button style, the flash decision in L2 and L3, the machine's load.

## Harness problems found

1. The factory's board cost leaves out the orchestrator chat and adds in an earlier attempt with the same job id.
2. The factory's PR comment uses only the last round's screenshots, so PR #19 has none.
3. The verifier skips the browser when a later round changes visible behaviour.
4. A gate re-run overwrites the failed `checks.md`.
5. A planner's flagged assumption does not reach the approver's "For the human" list.
6. The bugs reviewer missed the "never silently fail" rule.
7. The builder re-runs the full suite in fix rounds, and the gate then runs it again.
8. `builder.md` lacks the "write files with the Write tool, not the shell" rule.
9. Every verifier (all three drivers) leaves its API dev server running.
10. In L1 the gate's `COMMIT:` line records `HEAD` while it tests uncommitted work.
11. `/verify` records a failed round when Postgres is down instead of stopping first.
12. L1's cost is the long Opus chat; building with the `builder` agent or a Sonnet chat would cut most of it.

## How it was measured

- Agent cost and tokens: each agent's Claude Code transcript (`~/.claude/projects/<repo>/<session>/subagents/agent-*.jsonl`, and `agents/<adw-id>/logs/*.jsonl` for the ADW), priced with `factory/config.json` `prices_usd_per_mtok`. L3's total is the ADW's own `adw_state.json` `costs`.
- Timeline: the orchestrator's tool calls (L2), `agents/<adw-id>/adw_sdlc_iso/execution.log` (L3), the pair session's transcript (L1, active time = stretches without a gap over 10 minutes).
- Contrast and light-theme fidelity: every dark `color` / `background` pair a CSS rule uses, by the WCAG formula; the light palette substituted back into `App.css` and diffed against `main`.
- The scripts live in `agents/_experiments/` (git-ignored): `runs.py` (L2 and L3), `l1.py` (L1), `css3.py` (colours).
- The baseline code is in local git tags `baseline/theme-toggle-l1` (`ef98625`), `-l2` (`786b5a8`) and `-l3` (`697a9ea`); PR #16 and PR #19 are left open and unmerged on GitHub. The three job folders are archived in `agents/_archive/baseline-theme-toggle/` (git-ignored).
