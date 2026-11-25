# Plan: a fair A/B test of graphify in the harness

> Follows: [theme-toggle-graphify.md](../experiments/theme-toggle-graphify.md) · Type: chore (harness and experiment)

## Approach

Run 3 measured nothing, because no agent ever queried the graph. This test fixes that in four ways.

- **One variable.** The agent prompts are identical on both sides. Each role says "if the graph exists, find code with it; otherwise Grep/Glob". The only difference between the sides is whether `graphify-out/graph.json` exists in the main checkout.
- **A task that needs finding code.** A new intent that names no files and crosses `packages/shared`, `apps/api` and `apps/web`.
- **Less noise.** Before any run, fix the three harness problems that decided the rounds in run 3. Then run only L3, one run at a time, three runs per side.
- **Rules fixed in advance.** What counts as "better" is written down before the first run, and every run is reported, including any that make graphify look bad.

This can show that graphify helps, or that it doesn't. Every run is reported either way.

## Part 1: harness changes (one PR, Chris merges)

### Files

- `.claude/agents/planner.md`, `builder.md`, `scout.md`: add the same "Finding code" paragraph (below).
- `.claude/agents/planner.md`: code sketches follow CLAUDE.md's Rules (problem 3).
- `.claude/agents/reviewer-spec.md`: browser and manual criteria belong to the verifier (problem 4).
- `.claude/agents/builder.md`: format the copied spec and plan, and run the checks last (problem 10).
- `CLAUDE.md`, the "graphify" section: rewritten (below).
- `.gitignore` and `graphify-out/graph.json`: stop tracking the graph (`git rm --cached`). It is then built only in the main checkout, so job worktrees never contain it and no PR carries a rewritten graph (problem 12).
- `docs/HARNESS_CHANGELOG.md`: one entry per fix (before → after → why).
- `docs/experiments/theme-toggle-graphify.md`: run 3's results, now uncommitted on `main`.
- `docs/experiments/graphify-ab-protocol.md` (new): the protocol below, so it is fixed before the first run.

### The "Finding code" paragraph (planner, builder, scout)

> **Finding code.** If `<main checkout>/graphify-out/graph.json` exists, find code with the graph first: `cd <main checkout> && graphify query "<question>"`, `graphify explain "<symbol>"` or `graphify path "<A>" "<B>"`. Then read only the lines it points to. Otherwise, use Grep and Glob. Never run `graphify update`.

The graph describes `main`, the base every job branches from, so it is right for finding existing code. The scout has no Bash tool. Its paragraph says "Grep and Glob" only, unless I give it Bash, and that would be a second change. **Decision: leave the scout without Bash.** It only runs for high-risk jobs, and the paragraph is then a no-op for it on both sides.

### The CLAUDE.md "graphify" section, new text

- The graph is in the main checkout only (`graphify-out/`, git-ignored). Chris rebuilds it with `graphify update .` after a merge.
- Agents find code with it as their role says. They never run `graphify update`, and never in a job worktree.
- The current lines are removed: "After modifying code, run `graphify update .`" and "a large `graph.json` diff is expected".

### The three fixes

1. **Problem 3** (a silent `catch` in the plan): add to `planner.md` "Write plan.md": "Code in the plan follows CLAUDE.md's Rules. Every `catch` logs (`console.warn`/`console.error` in the web app, the logger in the API) and rethrows, or returns a typed fallback. Never a comment-only `catch`: the builder copies it."
2. **Problem 4** (the spec reviewer asks for the verifier's work): add to `reviewer-spec.md` "Trace": "A criterion checked in a browser or by hand is the verifier's, who runs in parallel with you. Mark it `verifier` in Traceability. It is never a finding, not even when build.md leaves it unchecked."
3. **Problem 10** (Prettier failed the gate on the docs): in `builder.md` "Build", round 1, add "format the copies with `pnpm exec prettier --write`". In "Test", add "run `checks.sh` last, after every file, docs included, is in place."

Not fixed, and why:

- **Problem 7** (`port stop`): it doesn't affect L3's results.
- **Problem 8** (concurrent runs): runs go one at a time.
- **Problems 9 and 11:** they are factory and chat issues, and this test runs only L3.

### Checks for Part 1

`pnpm lint` (the docs) and `bash factory/checks.sh`. Then a dry check with no LLM call:

- without the graph in the main checkout, `graphify hook-guard search` prints nothing;
- with it, the hook still adds its hint.

## Part 2: the task

Chris writes a new intent with `/intent`. It must:

- name no files or functions;
- touch the shared contract, the API and the web app;
- need no migration.

**Suggested:** "Requesters can edit a draft purchase request before submitting it". There is no edit route today (only create, submit and decide). It needs:

- a schema in `packages/shared`;
- an owner-only, draft-only API route through `withTenant`, with tests including tenant isolation;
- an edit mode in the web form.

Finding the existing create and submit patterns is the work a code graph should help with. Intake may route the security reviewer (API and data). That is fine: both sides get the same routing.

## Part 3: the runs

- **L3 only:** `uv run adws/adw_sdlc_iso.py <issue>`, one run at a time, with nothing else running.
- **Six runs in ABBA order**, so slow drift (API speed, time of day) hits both sides alike: with, without, without, with, with, without.
- **Each run gets a fresh issue** with the intent file as its body, from `gh issue create`.
- **Switching sides:**
  - "with": run `graphify update .` in the main checkout;
  - "without": move `graphify-out/` to `agents/_experiments/graphify-out.off/`, and back afterwards.

  Nothing else changes.

- **A driver script** (`agents/_experiments/ab.py`, git-ignored: experiment tooling, not harness) does every step for each run, and stops at the first error:
  1. set the side;
  2. create the issue;
  3. run the ADW;
  4. measure;
  5. archive `agents/<adw-id>` to `agents/_archive/ab-<slug>/<k>-<side>-<adw-id>/`;
  6. tag the branch `ab/<slug>-<k>-<side>`;
  7. close the PR and issue with a comment, delete the branch, run `adw_cleanup_iso`;
  8. drop leftover `lp_` test databases.
- **Pilot:** run 1 ("with") runs alone, then I check it. If its agents made no graphify queries, the setup has failed again. In that case I stop and report before spending the other five runs. A valid pilot counts as run 1.

Each run opens one issue and one PR on GitHub, and both are closed without merging: 6 issues and 6 PRs in total. **Cost estimate:** $2–3 per run, about $12–18 in all; 1–2 hours per run, so 6–12 hours unattended.

## Fixed before the first run: measures and the rule for "better"

- **Valid run:**
  - a "with" run has at least one `graphify query`, `explain` or `path` call;
  - a "without" run has none;
  - the run reaches READY or ESCALATE.

  An invalid run is reported as such and repeated, never dropped silently.

- **Primary measure, exploration:** input tokens and tool calls of the planner and the round-1 builder, plus the scout if it is routed.
- **Secondary measures:** total cost, wall time, rounds, Important findings, whether the gate passed on the first try, and acceptance criteria met.
- **"Graphify is better"** needs both:
  - the "with" mean of the primary measure is at least 20% lower;
  - every "with" run is below every "without" run.

  The same rule in reverse means "worse". Anything else means "no clear difference".

- **Quality guard:** a saving doesn't count as better if the "with" side has more rounds or more Important findings on average.
- **Results:** written to `docs/experiments/graphify-ab.md`, with all six runs, valid or not.

## Validation commands

```bash
pnpm lint
bash factory/checks.sh
uv run agents/_experiments/ab.py --dry-run   # prints each step, calls nothing
```

## Notes

- Results are from L3 only. A good result says the graph helps headless agents on this kind of task, not that L1 or L2 will improve.
- Three runs per side only show a large difference. If the result is "no clear difference", the next step is more runs, not a conclusion.
- Never merge a run's PR; `main` must stay without the feature so the task can be rerun.
