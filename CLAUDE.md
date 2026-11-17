# CLAUDE.md

A small multi-tenant purchase-request app (Levelpath interview demo), built **through** a visible agent harness. Tenant A must never read or write tenant B's data, enforced by Postgres RLS, not only by application code. Keep it small.

## Commands

| Command        | Healthy output                                                                 |
| -------------- | ------------------------------------------------------------------------------ |
| `pnpm install` | `Done in …`                                                                    |
| `pnpm build`   | `apps/api build: Done`, `apps/web build: ✓ built in …`, exit 0                 |
| `pnpm lint`    | `All matched files use Prettier code style!`, exit 0 (check only, never fixes) |
| `pnpm test`    | `Tests  N passed (N)` for `apps/api` and `apps/web`, exit 0                    |
| `pnpm dev`     | Postgres `healthy`, `api listening on http://localhost:3000`, Vite on 5173     |
| `pnpm db:up`   | `Container … Healthy`                                                          |

One app on chosen ports (agents always do this): `API_PORT=<a> pnpm --filter @levelpath/api dev` and `pnpm --filter @levelpath/web dev --port <w> --strictPort`; stop with `factory/bin/port stop <port>`.

## Architecture

- `apps/api`: NestJS 12 (ESM-only: relative imports end in `.js`), Vitest. Modules, controllers, services, DI.
- `apps/web`: React 19 + Vite, Vitest + Testing Library.
- `packages/shared`: Zod schemas and types shared by api and web.
- `db/`: migrations, RLS policies, seed data (Phase 2).
- `docs/`: `intent/`, `specs/`, `plans/` (the artifact trail), `templates/`, `LEARNING.md`, `HARNESS_CHANGELOG.md`.

## The harness

One set of roles in `.claude/agents/`, three drivers:

- **L1 (pair):** `/intent` → `/spec` → `/plan` → build together → `/verify` → `/review`.
- **L2 (supervised):** `/factory run`.
- **L3 (unattended):** `uv run adws/adw_sdlc_iso.py <issue>`, or an `adw` comment.

Every driver uses the same parts:

- **The gate:** `factory/checks.sh`.
- **The guards:** `.claude/hooks/guard.py`.
- **The review rules:** `REVIEW.md`.
- **The plan formats:** `docs/templates/`.

Every driver ends with a PR that **only Chris merges**. Before merging, `/try <pr>` runs it locally.

## Rules

- **Plan before code.** Wait for approval of the plan before editing files.
- **Verify before "done".** Run `pnpm build`, `pnpm lint` and `pnpm test`, and paste the output. If a test fails, fix the code, not the test.
- **Never mock the database or RLS.** The LLM provider is the only allowed fake (cost, determinism).
- **Never silently fail.** Every `catch` logs and rethrows, or returns a typed error.
- **Read the whole file** before changing it.
- **`.env` is off limits.** Use `.env.sample`. The guard hook blocks reads and environment dumps.
- **No commits unless Chris asks. No merges, ever.** The guard blocks `gh pr merge`, approvals and pushes to `main`.
- **pnpm only.** Python in `adws/` runs with `uv run` (Avast: `UV_NATIVE_TLS=1`). The hooks are stdlib-only and run with `python3`.
- **Log lessons.**
  - A corrected mistake or a caught problem goes in `docs/HARNESS_CHANGELOG.md` (before → after → why).
  - A new concept goes in `docs/LEARNING.md`.

## Verifying your work

```bash
bash factory/checks.sh   # what the gate runs: install, build, lint, test
```

For behaviour, run the app on your ports and exercise the acceptance criteria (the `verifier` agent does this in every round).

## Things Claude gets wrong

- **Remembered library versions.** Before naming a library, runner or tool, check its current major, module format (ESM or CJS) and peer ranges with `pnpm view <pkg> dist-tags peerDependencies`. Phase 0 planned Jest for Nest 12, which is ESM-only, and `typescript@latest` (7.x), which `typescript-eslint` rejects.

- **Dropping something Chris built inside a plan.** A capability from one of the source harnesses (for example tac-combined's live UI) is never dropped as one line of a plan: ask it as its own decision, with options and a recommendation.

- **Publishing code without checking where it came from.** Before code from another repository goes into this public one, check that repository's visibility (`gh repo view <repo> --json visibility`). From a private source, only ideas come over: write the code here.
