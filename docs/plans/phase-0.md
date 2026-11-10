# Plan — Phase 0: Environment

Status: **IMPLEMENTED, awaiting your "next".**

Deviations from the approved plan (both logged in `docs/HARNESS_CHANGELOG.md` / `docs/LEARNING.md`):

1. **API tests use Vitest, not Jest, and the API is an ES module.** The npm `latest` NestJS (12.4.2) is ESM-only and Jest could not load `@nestjs/testing`. Chris chose Nest 12 + Vitest over Nest 11 (CommonJS).
2. **TypeScript is pinned to 5.9.3.** `typescript@latest` is 7.0.2, which `typescript-eslint` does not support (peer `<6.1.0`).
3. **The health endpoint has a tiny `HealthService`** so the test proves real constructor injection (decorator metadata), which Phase 2 depends on.

## Goal

Clone, run one command, see Postgres up and empty apps building. `pnpm build | lint | test | dev` each exit non-zero on failure.

## Decisions (from the Q&A)

| Topic              | Choice                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test runner        | ~~Jest for `apps/api`~~ changed: Vitest for both `apps/api` and `apps/web` (see deviations above)                                                      |
| Root orchestration | Plain `pnpm -r` scripts, no Turborepo                                                                                                                  |
| Nest scaffold      | Hand-written minimal app (health endpoint only); `@nestjs/cli` used only as a build/dev tool                                                           |
| Docker Compose     | Postgres only; api and web run on the host                                                                                                             |
| Other defaults     | Branch `main`, Node 24 (`.nvmrc` + `engines`), ESLint flat config + typescript-eslint, Prettier with LF, harness = `git-adw` base (decided in Phase 1) |

## Prerequisite (you)

Start Docker Desktop. The daemon was not running when I checked.

## Files to create (repo root = `levelpath-demo/`)

**Root**

- `package.json` (private; `engines.node >=24`; scripts `build`, `lint`, `test`, `dev`, `db:up`, `db:down`)
- `pnpm-workspace.yaml` (`apps/*`, `packages/*`)
- `tsconfig.base.json` (strict; shared options)
- `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`
- `.gitignore`, `.gitattributes` (`* text=auto eol=lf`), `.nvmrc`
- `docker-compose.yml` (Postgres, named volume, healthcheck, port from env)
- `.env.sample` (DB name/user/password/port placeholders; real `.env` stays git-ignored)

**`packages/shared`**: `package.json`, `tsconfig.json`, `src/index.ts` (placeholder export; Zod arrives in Phase 2/4). Built with `tsc`.

**`apps/api`** (NestJS)

- `package.json`, `tsconfig.json`, `jest.config.ts`
- `src/main.ts`, `src/app.module.ts`, `src/health.controller.ts` (`GET /health` -> `{ status: "ok" }`)
- `src/health.controller.spec.ts` (one real test)

**`apps/web`** (Vite + React + TS)

- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- `src/main.tsx`, `src/App.tsx`, `src/App.test.tsx` (Vitest + Testing Library, one real test)

**Placeholders**: `db/.gitkeep`, `evals/.gitkeep`, `docs/intent/.gitkeep`, `docs/specs/.gitkeep`

**Docs**

- `docs/LEARNING.md`: entries for pnpm workspaces, tsconfig base, Nest module/controller/DI basics, Docker Compose healthcheck
- `docs/HARNESS_CHANGELOG.md`: header and format only (first real entries arrive in Phase 1)

**Not in Phase 0**: `CLAUDE.md`, `.claude/`, `REVIEW.md`, migrations, auth, CI. They belong to later phases.

## Root commands

| Command                  | Behaviour                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `pnpm build`             | `pnpm -r build` (shared first, then api and web)                                                               |
| `pnpm lint`              | `eslint .` and `prettier --check .`                                                                            |
| `pnpm test`              | `pnpm -r test` (Jest api, Vitest web)                                                                          |
| `pnpm dev`               | `docker compose up -d --wait db`, then `pnpm -r --parallel dev` (api via `nest start --watch`, web via `vite`) |
| `pnpm db:up` / `db:down` | Start / stop Postgres only                                                                                     |

Note for the API dev server: `tsx` and esbuild do not emit the decorator metadata Nest DI needs, so I use `nest start --watch`.

## Steps

1. `git branch -m main`; add `.gitignore`, `.gitattributes`, `.nvmrc`.
2. Root `package.json`, workspace file, `tsconfig.base.json`, ESLint and Prettier configs.
3. `packages/shared`.
4. `apps/api` with health controller and test.
5. `apps/web` with App and test.
6. `docker-compose.yml` and `.env.sample`.
7. Docs skeletons.
8. `pnpm install`, then run the verification below.
9. Check the Postgres image major version against current Docker Hub tags before pinning (not guessing).

## Verification (output pasted in the summary)

1. `pnpm install` finishes without errors.
2. `pnpm build` exits 0.
3. `pnpm lint` exits 0.
4. `pnpm test` exits 0 and shows 2 passing tests (api and web).
5. `docker compose up -d --wait db` shows the `db` container `healthy`; `docker compose exec db psql -U <user> -c "select 1"` returns a row.
6. `pnpm dev`: `curl localhost:<api-port>/health` returns `{"status":"ok"}`, and the web dev server serves the page.
7. Negative checks: a deliberate lint error and a deliberate failing test each make the root command exit non-zero (then reverted).

## Out of scope / risks

- No commit is made unless you ask. I will propose an initial commit at the end.
- A local Postgres already on port 5432 would clash; the port is configurable in `.env`.
- Windows: no shell scripts are used, only `pnpm` and Node, to avoid CRLF and shell issues.

## Done when

A fresh clone plus `pnpm install && pnpm dev` brings up healthy Postgres, the API health endpoint and the web page, and the four root commands behave as above.
