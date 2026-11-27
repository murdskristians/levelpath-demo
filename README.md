# levelpath-demo

A small multi-tenant purchase-request app (tenants, requesters and approvers, suppliers, purchase requests and approvals), built **through** a visible agent harness. Specs live in markdown, agents do most of the typing, and a person steers, reviews and merges. Tenant isolation is enforced by Postgres row-level security, not only by application code.

Stack: NestJS 12 (ESM), PostgreSQL with RLS, React 19 + Vite, TypeScript everywhere, pnpm workspaces, Docker Compose.

## The harness

One set of agent roles, three ways to drive them (the autonomy dial):

```
 L1 pair        /intent → /spec → /plan → builder agent → /verify → /review
 L2 supervised  /factory run <issue>            (a skill in a Claude Code session, with a dashboard)
 watch all      factory/bin/serve → http://127.0.0.1:8000   (the control room: Board + live Agents)
 L3 unattended  uv run adws/adw_sdlc_iso.py <issue>, or an `adw` comment on the issue
 ─────────────────────────────────────────────────────────────────────────────
 roles   intake · scout · planner · builder · verifier · reviewer-bugs · reviewer-spec · reviewer-security · approver
 gate    factory/checks.sh        guards   .claude/hooks/guard.py        rules   REVIEW.md · CLAUDE.md · skills · code graph
 end     a ready PR that only a person merges
```

- **What it is:** [docs/HARNESS.md](docs/HARNESS.md).
- **Where each part came from**, and how it was combined from three earlier harnesses: [CREDITS.md](CREDITS.md).
- **How it evolved:** [docs/HARNESS_CHANGELOG.md](docs/HARNESS_CHANGELOG.md), every change as before → after → why.

## Run the app

Needs Node 24, pnpm 10 and Docker.

```bash
pnpm install
pnpm dev      # Postgres (healthy), the API on :3000, the web app on :5173
pnpm db:migrate && pnpm db:seed   # the tables (RLS forced on each) and two demo companies
pnpm build    # all three must exit 0; the harness's gate runs the same
pnpm lint
pnpm test     # needs Postgres up (pnpm db:up): each run uses its own throwaway database
```

Ask the API who you are: `curl -H "X-User-Id: a0000000-0000-4000-8000-000000000101" localhost:3000/me` returns Alice, requester at Acme Corp.

> **`X-User-Id` is a development stub, not authentication.** Anyone can send any seeded user's id. It stands in for a real login so the demo can show what matters here: every query runs in a transaction scoped to the caller's company, and Postgres row-level security refuses the rest. Real authentication is out of scope.

## Use the harness

Also needs [Claude Code](https://claude.com/claude-code), `gh` (logged in), `uv`, Python 3.11+ and [graphify](https://github.com/Graphify-Labs/graphify), the code graph the planner and builder must query first. Set the graph up once, in the main checkout:

```bash
uv tool install graphifyy      # the graphify CLI
graphify update .              # build the graph into graphify-out/ (git-ignored)
graphify hook install          # git hooks rebuild it after every commit, checkout and pull
git checkout .gitattributes    # undo the line hook install adds: graph.json isn't tracked
```

Without the graph the harness still works: the agents fall back to searching, and the `graph_first` hook warns once per agent.

- **Pair (L1):** open Claude Code here and run `/intent <idea>`.
- **Supervised (L2):** label an issue `factory`, then `/factory run <n>`.
- **The control room:** `factory/bin/serve`, then open http://127.0.0.1:8000. The **Board** shows every run, whichever driver started it. A run's **Agents** tab shows each agent's actions live, plus the orchestrator's decisions. The **prompt box** files an issue and starts an unattended run.
- **Unattended (L3):** `uv run adws/adw_sdlc_iso.py <n>`, or start `uv run adws/adw_triggers/trigger_cron.py` and comment `adw` on the issue.

Each driver ends with a pull request labelled `factory:needs-human`. To check it locally, run `/try <pr>`; then merge it on GitHub. Nothing in the harness can merge. Afterwards, `/factory run` (or `factory/bin/job queue`) closes out factory jobs; for an ADW run, use `uv run adws/adw_cleanup_iso.py <issue> <adw_id>`.

### Where a run lives

Every run happens on your machine. The factory and the ADWs never touch your checkout or its branch: each run gets its own **worktree** (a second working folder of the same repo, on its own branch, with its own ports) for the code, and a **job folder** for its paperwork. Both are gitignored.

| Driver        | Start it                                                                                     | Code (worktree, branch)                           | Paperwork (job folder)                 | On the board         | After you merge the PR                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| L1 pair       | `/intent <idea>` in Claude Code                                                              | your own checkout, on a branch you create         | `agents/<slug>/`                       | no card              | nothing to clean up                                                                                                       |
| L2 factory    | label an issue `factory`, then `/factory run <n>` (or `/factory <feature>` to file it too)   | `.worktrees/<job-id>/`, branch `factory/<job-id>` | `factory/jobs/<job-id>/`               | a card, `chat` badge | `/factory run` or `factory/bin/job queue`: marks it merged, removes the worktree                                          |
| L3 unattended | the control room's **Start run** box, `uv run adws/adw_sdlc_iso.py <n>`, or an `adw` comment | `trees/<adw-id>/`, branch `adw/<adw-id>-<slug>`   | `agents/<adw-id>/` (an 8-character id) | a card, `ADW` badge  | `uv run adws/adw_cleanup_iso.py <issue> <adw-id>`: removes the worktree and the local branch, marks it merged (or closed) |

The job folder holds the files the agents hand to each other: `issue.md`, `intake.md`, `spec.md`, `plan.md`, `build.md`, `round-N/` (the gate's `checks.md`, each `review-*.md`, the verifier's `shots/`) and `decision.md`. It stays after cleanup as the run's record; the control room reads it.

A run's life, L3 as the example:

1. Type the feature in the control room (`factory/bin/serve`, http://127.0.0.1:8000) and click **Start run**. It files a GitHub issue and starts the pipeline.
2. Watch it: click the card, then **Agents** for each agent live, or **Files** for its paperwork.
3. When the card reaches **Needs human**, the PR is ready. Run `/try <pr>` to click through it locally.
4. Merge it on GitHub (or close it).
5. Run `uv run adws/adw_cleanup_iso.py <issue> <adw-id>`.

## Layout

```
apps/api           NestJS API          apps/web      React SPA        packages/shared   Zod schemas
db/                migrations, RLS     evals/        LLM-feature evals
docs/              intent/ specs/ plans/ templates/ · HARNESS.md · HARNESS_CHANGELOG.md · LEARNING.md
.claude/           agents/ (roles) · commands/ (L1) · skills/ · hooks/ · settings.json
factory/           L2: bin/job (state machine) · bin/gate · bin/route · checks.sh · config.json · dashboard
adws/              L3: headless pipeline over the same roles
```

`docs/plans/` refers to the project brief (`KICKOFF.md`), which is kept private.

## Licence

GPLv3, because the harness includes code from the GPLv3 [ZazenCodes software factory](https://github.com/zazencodes/zazencodes-season-3/tree/main/src/software-factory-claude-code-v2). See [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md).
