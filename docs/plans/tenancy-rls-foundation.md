# Plan: Tenancy and RLS foundation (five tenant tables, forced RLS, `withTenant`, stub auth)

> Spec: docs/specs/tenancy-rls-foundation.md · Type: feature

## Approach

Plain SQL migrations in `db/migrations/`, applied as the owner by a small ESM runner in `apps/api/db-tools/` (so it can use `pg`, which only `apps/api` depends on). The API connects as the non-owner app role through Kysely. One injectable `DatabaseService` holds the only pool and offers exactly two methods: `withTenant` and `resolveUser`. A global `AuthGuard` (public routes opt out) resolves `X-User-Id`. A Vitest global setup creates `lp_<random>`, migrates and seeds it as the owner, and drops it at the end. Specs reach the database through that run's name, passed with Vitest's `provide`/`inject`.

The four calls the spec left to the plan:

1. **User lookup for the guard: a `SECURITY DEFINER` function, `app_resolve_user(uuid)`.**
   - A second `SELECT` policy on `users` (for example `id = current_setting('app.user_id')`) is OR-ed with `tenant_isolation`. It would make the app role's `users` table readable in a way that depends on a second session setting the caller controls, and it adds a second path through `withTenant`.
   - The function is one object that takes one id and returns one row `(id, tenant_id, role)`. RLS on `users` stays untouched. It is easy to audit and test (criterion 16).
   - Rules for the migration: `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp`; every table name schema-qualified (`public.users`); `REVOKE ALL ... FROM PUBLIC`; `GRANT EXECUTE` to the app role only.
   - It runs as the owner. The image's owner is a superuser, so it bypasses RLS, and that is exactly why the function exists. The docs say so.
   - `DatabaseService.resolveUser(id)` calls it with a parameterised `sql` template on the pool. It is not `withTenant`, because no tenant is known yet.

2. **App role creation under concurrent runs.**
   - A lock taken inside each run's own `lp_*` database does not serialize anything, because advisory locks are per database.
   - `ensureAppRole()` therefore opens its own owner connection to the shared **admin database** (`POSTGRES_DB`, default `levelpath`, which compose always creates and which setup already uses for `CREATE DATABASE`). It takes `pg_advisory_lock(hashtext('levelpath:ensure-app-role'))` there, checks `pg_roles`, runs `CREATE ROLE ... LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ...` if missing, then unlocks and closes. Every run uses the same lock database, so they serialize.
   - Role name and password are never string-concatenated by hand: validate the name against `^[a-z_][a-z0-9_]*$`, then use `client.escapeIdentifier` and `client.escapeLiteral`. Never log the password.
   - The role is not altered if it exists (no password reset).
   - Migrations refer to the role as `{{app_role}}`. The runner replaces it with the escaped identifier before running the file. The run's own `lp_*` database needs no `GRANT CONNECT`: new databases give `CONNECT` to `PUBLIC`.

3. **Role and status values live in `apps/api` (`apps/api/src/db/values.ts`).**
   - `packages/shared` is a CJS-output placeholder that nothing depends on, and `apps/api` has no workspace dependency on it. Wiring it now means a new dependency, a build-order edge and an ESM/CJS interop check, with the API as the only consumer.
   - The web app first needs the values in Phase 3. Move them to `packages/shared` then. No Zod now.
   - A spec asserts the TS lists are accepted by the DB `CHECK`s, so the two copies can't drift unnoticed.

4. **Per-run database and how Nest finds it.**
   - `apps/api/test/global-setup.mjs` (Vitest `globalSetup`) connects as the owner to the admin DB. If that fails, it throws an error that contains "run `pnpm db:up`", so the run exits non-zero and nothing is skipped (criteria 18, 19).
   - It does `CREATE DATABASE lp_<12 hex from crypto.randomBytes>`, then `migrate({ database })` and `seed({ database })`, then `project.provide('testDbName', name)`.
   - The returned teardown runs `DROP DATABASE IF EXISTS <name> WITH (FORCE)`. A setup that fails partway also drops what it created before rethrowing.
   - Nothing mutates `process.env`. `AppModule` gets its connection settings from an injection token `DB_CONFIG` (default factory: env with docker-compose defaults). `test/helpers.ts` builds the app with `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DB_CONFIG).useValue({ ...defaults, database: inject('testDbName') })`.
   - Specs share one database, so `vitest.config.ts` sets `fileParallelism: false`. Tests that write create rows with fresh uuids and delete them.

## Libraries and versions

Checked with `pnpm view <pkg> dist-tags peerDependencies`.

| Package     | Add as           | Version                   | Module format                                                                                                             | Peers                                                                                              |
| ----------- | ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `kysely`    | dependency       | `^0.29.9` (latest 0.29.9) | ESM (`"type": "module"`)                                                                                                  | none; engines node `>=22` (repo needs `>=24`)                                                      |
| `pg`        | dependency       | `^8.23.1` (latest 8.23.1) | CJS core with an ESM wrapper (`exports.import` = `./esm/index.mjs`), so `import pg from 'pg'` and named imports both work | only optional `pg-native >=3.0.1`: do not install                                                  |
| `@types/pg` | devDependency    | `^8.23.1` (latest 8.23.1) | types only                                                                                                                | none                                                                                               |
| `vitest`    | already `^5.1.0` | latest 5.1.0              | ESM                                                                                                                       | `@types/node ^22 \|\| >=24` is met by `^24.19.2`; `vite ^6.4 \|\| ^7 \|\| ^8` is already satisfied |

- Nest 12 stays ESM-only: relative imports end in `.js`.
- No `supertest`: HTTP tests use `app.listen(0)` and Node's built-in `fetch`.
- No Zod, no `dotenv` (scripts read `process.env` only; defaults match `docker-compose.yml`), no `uuid` package (`node:crypto` `randomUUID` and a UUID regex).
- The builder runs `pnpm add` in `apps/api` only to update `package.json` and the lockfile, then re-runs the version check.

## Files

- `apps/api/package.json` — add `kysely`, `pg`, `@types/pg`; scripts `db:migrate` (`node db-tools/migrate-cli.mjs`) and `db:seed` (`node db-tools/seed-cli.mjs`).
- `package.json` (root) — scripts `db:migrate` and `db:seed` that run `pnpm --filter @levelpath/api db:migrate` and `db:seed`.
- `pnpm-lock.yaml` — updated by `pnpm add`.
- `apps/api/vitest.config.ts` — `globalSetup: ['./test/global-setup.mjs']`, `fileParallelism: false`, `testTimeout: 15000`.
- `apps/api/src/app.module.ts` — import `DatabaseModule`, `AuthModule`, `MeModule`.
- `apps/api/src/health.controller.ts`, `apps/api/src/version.controller.ts` — add `@Public()` only. Their specs stay unchanged.
- `.env.sample` — add `POSTGRES_HOST`, `APP_DB_USER`, `APP_DB_PASSWORD` (dev default `levelpath_app_dev_password`), and a comment that the API and scripts read the process environment, not `.env`. Edit `.env.sample` only, never `.env`.
- `CLAUDE.md` — commands table (`pnpm db:migrate`, `pnpm db:seed`), the "tests need Postgres up (`pnpm db:up`)" line, `db/` and `apps/api` layout, the `X-User-Id` dev-stub warning, and fix the "(Phase 2)" markers.
- `README.md` — a short "X-User-Id is a dev stub" note (read it first; add it where the dev setup is described).
- `docs/LEARNING.md` — entries (What, Why it matters, Where) for: RLS with `FORCE`; the non-owner app role (superuser and owner bypass RLS); the transaction-local tenant setting and the pool leak; composite foreign keys; the `SECURITY DEFINER` lookup and its `search_path`; and that `X-User-Id` is not authentication. Update the Kysely entry's "(Phase 2)" wording if needed.
- `docs/HARNESS_CHANGELOG.md` — one entry: the per-run database moved from `factory/checks.sh` (protected) to the Vitest global setup.
- `.claude/skills/rls-data-access/SKILL.md` — replace "Phase 2 will choose" with the real helpers: `withTenant`, `DatabaseService`, `pnpm db:migrate`, `pnpm db:seed`, the `NULLIF` policy form (and why), `{{app_role}}`, the composite-key rule, the per-run database setup, and the lookup function. Fix the sample SQL to the `NULLIF` form.
- `.claude/skills/factory/SKILL.md` and `adws/README.md` — one line each: Postgres must be up (`pnpm db:up`) before a run, because the gate's tests create their own database on it.
- `.claude/skills/nestjs-endpoint/SKILL.md` — name `AuthGuard`, `@Public()`, `@CurrentUser()`, and the Zod note ("not wired yet").

### New files

- `db/migrations/0001_tenants_and_users.sql` — `tenants`, `users` (`UNIQUE (tenant_id, id)`, `users.tenant_id` plain FK to `tenants(id)`), `CHECK role IN ('requester','approver')`; enable and force RLS, `tenant_isolation` policy (`tenants` on `id`, `users` on `tenant_id`); `GRANT SELECT` only; the `app_resolve_user` function with its revoke and grant.
- `db/migrations/0002_suppliers.sql` — `suppliers`, `UNIQUE (tenant_id, id)`, FK `tenant_id` to `tenants`, RLS, full CRUD grant.
- `db/migrations/0003_purchase_requests.sql` — columns per requirement 4. `requester_id` and `supplier_id` are `NOT NULL`: every request has a requester and a supplier for now (Phase 3 can relax `supplier_id` for drafts with a new migration). This is a product rule, not the isolation: a composite FK with a NULL member is skipped (`MATCH SIMPLE`), which is safe because a NULL references nothing, and `tenant_id` is `NOT NULL` on every table. `UNIQUE (tenant_id, id)`; composite FKs `(tenant_id, requester_id)` to `users(tenant_id, id)` and `(tenant_id, supplier_id)` to `suppliers(tenant_id, id)`; `CHECK (amount_cents >= 0)`; `CHECK status IN (...)`; RLS; full CRUD grant.
- `db/migrations/0004_approvals.sql` — composite FKs to `purchase_requests` and `users` (approver); `CHECK decision IN ('approved','rejected')`; RLS; full CRUD grant.
- `db/seed.sql` — idempotent (`INSERT ... ON CONFLICT (id) DO NOTHING`), in one transaction, fixed ids. The six ids in requirement 8 are given. Others follow the same style, for example suppliers `…0201`/`…0202`, purchase requests `…0301` to `…0304` (draft, submitted, approved, rejected), approvals `…0401`/`…0402`, with prefix `a0000000-…` for Acme and `b0000000-…` for Globex. Each approval's approver is that tenant's approver.
- `apps/api/db-tools/db-lib.mjs` — plain ESM with JSDoc, no TS. Exports `dbConfig(env)` (reads `POSTGRES_HOST|PORT|DB|USER|PASSWORD`, `APP_DB_USER|PASSWORD`, with compose defaults), `ensureAppRole()`, `migrate({ database })` returning the applied filenames (calls `ensureAppRole()` first, so the CLI and the test setup both get the role before any `GRANT`; creates `schema_migrations` if missing, takes an advisory lock inside the target database for its own run, and applies each file and its `schema_migrations` insert in one transaction, in filename order), and `seed({ database })`. The migrations dir is resolved from the file's location (`../../db/migrations`).
- `apps/api/db-tools/migrate-cli.mjs`, `seed-cli.mjs` — thin wrappers: print each applied file, or "nothing to apply", exit non-zero with the error on failure.
- `apps/api/test/global-setup.mjs` — see Approach, item 4.
- `apps/api/test/helpers.ts` — `createTestApp()`, `ownerClient()`, `appRoleClient()` (raw `pg` clients to the run database), and the `ProvidedContext` module augmentation for `testDbName`. These live outside `src`, so `nest build` doesn't compile them and the owner role name appears only here and in `db-tools`.
- `apps/api/src/db/schema.ts` — hand-written Kysely `Database` interface (`Generated<>` and `ColumnType` for ids, defaults and timestamps). `amount_cents` is bigint, which `pg` returns as a string: type it as a string and note it.
- `apps/api/src/db/values.ts` — `USER_ROLES`, `PURCHASE_REQUEST_STATUSES`, `APPROVAL_DECISIONS` (`as const`) and their types.
- `apps/api/src/db/db-config.ts` — `DbConfig` type, `DB_CONFIG` token, `dbConfigFromEnv()`. App role only: `POSTGRES_USER` is never read here.
- `apps/api/src/db/database.service.ts` — the only file that imports `kysely` or `pg` pools. Private Kysely instance; exports `withTenant` and `resolveUser`; `onModuleDestroy` calls `destroy()`. Optional `log` callback in `DbConfig` lets tests record SQL.
- `apps/api/src/db/database.module.ts` — provides `DB_CONFIG` (factory) and `DatabaseService`; exports `DatabaseService` only.
- `apps/api/src/auth/public.decorator.ts` (`@Public()`), `auth.guard.ts` (`AuthGuard`), `current-user.decorator.ts` (`@CurrentUser()`), `auth.module.ts` (provides the guard through `APP_GUARD`, imports `DatabaseModule`), and `auth-user.ts` (`AuthUser = { userId, tenantId, role }`).
- `apps/api/src/me/me.controller.ts`, `me.service.ts`, `me.module.ts` — `GET /me`.
- Specs: `apps/api/src/db/migrations.spec.ts`, `rls-isolation.spec.ts`, `with-tenant.spec.ts`, `user-lookup.spec.ts`, `apps/api/src/auth/auth.guard.spec.ts`, `apps/api/src/me/me.controller.spec.ts`.

## Steps

### 1. Dependencies and config

- `pnpm --filter @levelpath/api add kysely@^0.29.9 pg@^8.23.1` and `pnpm --filter @levelpath/api add -D @types/pg@^8.23.1`. Re-run `pnpm view` and confirm the versions match "Libraries and versions". Do not add `pg-native`.
- Add the scripts and the Vitest config changes listed in Files.

### 2. Migrations, seed, runner (db first)

- Write the four migrations and `seed.sql`.
- Policy form, on every table (replace the column per table): `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (same)`.
- Write `db-lib.mjs`, the CLIs, `global-setup.mjs` and `helpers.ts`.
- Tests with the behaviour:
  - `migrations.spec.ts`: criteria 1 (re-running `migrate()` returns `[]`, `schema_migrations` lists each file once, only the expected tables exist), 2, 3, 4, 9.
  - `rls-isolation.spec.ts`: criteria 5 to 8.
- Run `pnpm --filter @levelpath/api test` with Postgres up.

### 3. `DatabaseService`, `withTenant`, `resolveUser`

- `withTenant(tenantId, fn)`:
  1. Throw before any query if `tenantId` isn't a UUID (regex).
  2. `db.transaction().execute(async trx => { await sql\`select set_config('app.tenant_id', ${tenantId}, true)\`.execute(trx); return fn(trx); })`.
  3. Kysely commits on success and rolls back and rethrows on error. Catch only to log with context, then rethrow.
- Type `fn` as `(trx: Transaction<Database>) => Promise<T>`. Export that type for services.
- `resolveUser(userId)`: UUID check, then `select * from app_resolve_user(${userId})` on the pool, returning `AuthUser | undefined`. Nothing else in the codebase touches the pool.
- Pool settings: `max` configurable through `DbConfig`, so tests can set 1.
- For criterion 11, the test builds the service with a pool of one connection (`max: 1` in `DbConfig`) and runs its plain query on that same pool, through a test-only accessor or a pool the test passes in through `DbConfig`. Application code still has no way to reach the pool.
- For criterion 16, scope the `pg_proc` check to the `public` schema: the app role can execute the built-in functions in `pg_catalog`, as every role can.
- Tests (`with-tenant.spec.ts`, `user-lookup.spec.ts`): criteria 10, 11 (pool of 1 connection), 12 (recorded SQL shows `set_config` right after `begin`), 16 (as the app role with no tenant, `select * from users` returns 0; `pg_proc` lists only functions the role can execute that take a single id).

### 4. Auth guard, `GET /me`

- `AuthGuard.canActivate`:
  1. Use `Reflector.getAllAndOverride(IS_PUBLIC, [handler, class])`. Public routes pass.
  2. Otherwise read `x-user-id`. It must be a single string and match the UUID regex.
  3. Call `resolveUser`.
  4. On any failure throw `UnauthorizedException()` with one fixed message, the same for malformed, missing and unknown ids (criterion 13).
  5. Otherwise set `request.authUser` and return true.
- `@CurrentUser()` reads `request.authUser`. Nothing reads tenant or role from the body, query or params.
- `MeService.me(user)` calls `withTenant(user.tenantId, trx => …)` and selects the `users` row (by `user.userId`) and the `tenants` row (by `user.tenantId`). If either is missing, throw `UnauthorizedException`. Return `{ user: { id, name, role }, tenant: { id, name } }`.
- `MeController` is `@Controller('me')` with `@Get()` and `@CurrentUser()`.
- Add `@Public()` to `HealthController` and `VersionController`.
- Tests: `auth.guard.spec.ts` and `me.controller.spec.ts` start the real app on `app.listen(0)` and call it with `fetch` for criteria 13 to 15 and 17 (also assert the 401 bodies are identical, and `?tenantId=` and `X-Tenant-Id` are ignored). Close the app in `afterAll`.

### 5. Docs

Edit the docs and skills listed in Files. Check criteria 23 to 26 line by line.

### N. Validate

Run the validation commands below. Run two test runs at once and then check no `lp_*` database is left (criterion 18). Stop Postgres and check the failure message (criterion 19).

## Tests

All run against the real database and policies, with nothing mocked.

- **Isolation** (`rls-isolation.spec.ts`): for each of the five tables, from `withTenant(A)`, select B's rows by filter and by exact id returns none. For `suppliers`, `purchase_requests` and `approvals`: update and delete of B's id affect 0 rows (verified as owner), insert with `tenant_id = B` fails RLS, moving an A row to B fails `WITH CHECK`. For `tenants` and `users`: update, insert and delete fail with "permission denied".
- **Cross-tenant FK** (owner connection): wrong-tenant `supplier_id`, `requester_id`, approval `purchase_request_id` and approver all fail.
- **Fail closed:** raw app-role connection with no setup sees 0 rows; an empty `app.tenant_id` returns 0 rows without an error.
- **Pool leak:** a pool of 1 connection, `withTenant(A)`, then a plain query sees 0 rows, then `withTenant(B)` sees only B. A throwing `fn` rolls back and the connection still works. `current_setting('app.tenant_id', true)` is null or empty afterwards.
- **Input guard:** `withTenant('not-a-uuid')` and `withTenant('')` throw before a query. The SQL log shows `set_config` as the first statement.
- **Role and catalog:** criteria 2 and 3, and the lists in `values.ts` match the `CHECK` constraints.
- **Auth and `/me`:** 401 for missing, malformed and unknown ids (identical bodies); 200 for Alice and Boris; the tenant can't be chosen by query or header; `/health` and `/version` work without a header.
- **Idempotency:** `migrate()` twice, and `seed()` twice with unchanged row counts.

## Validation commands

```bash
pnpm db:up
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm test
bash factory/checks.sh
# idempotency (runs against POSTGRES_DB, the dev database)
pnpm db:migrate   # lists applied files (or "nothing to apply" on a migrated database)
pnpm db:migrate   # second run: "nothing to apply"
pnpm db:seed && pnpm db:seed
# parallel runs leave nothing behind
(pnpm --filter @levelpath/api test & pnpm --filter @levelpath/api test & wait)
docker compose exec db psql -U levelpath_owner -d levelpath -tc "select datname from pg_database where datname like 'lp\_%'"
# fail loudly without Postgres
pnpm db:down && pnpm --filter @levelpath/api test   # expect non-zero and "pnpm db:up" in the output
rg -n "levelpath_owner" apps/api/src               # expect no match
```

## Notes

- **CLI target.** `pnpm db:migrate` and `pnpm db:seed` act on `POSTGRES_DB` (default `levelpath`). A first-time check on a fresh volume (`pnpm db:down -v` is not needed; use `docker compose exec db psql ... -c "drop schema public cascade; create schema public"` only if the user agrees) is not required: the per-run database in the test suite already proves the empty-database case.
- **Superuser owner assumption.** Seed and the `SECURITY DEFINER` function rely on the compose owner being a superuser (it bypasses RLS even with `FORCE`). Say so in `docs/LEARNING.md`; do not try to support a non-superuser owner.
- **Migration runner rules.** Files are plain SQL with no `BEGIN` or `COMMIT`; the runner wraps each in a transaction. Placeholder is exactly `{{app_role}}`. The app role has no access to `schema_migrations` (never granted).
- **Error handling.** Every `catch` logs with context and rethrows. No `catch {}`. Log no `X-User-Id` values or user names.
- **Teardown on interrupt.** Vitest runs the globalSetup teardown on normal exit and on test failure. A hard kill can leave an `lp_*` database; the setup does not sweep other runs' databases (it could drop a concurrent run's).
- **Bigint.** `amount_cents` comes back from `pg` as a string. Leave the parser alone; Phase 3 decides the API shape.
- **`main.ts`.** No change needed beyond `app.enableShutdownHooks()` so the pool closes cleanly (optional, one line).
- **Review round 1 (Chris's decisions).** The harness fixes found during this phase (the planner's self-check in `.claude/agents/planner.md`, `.claude/task-type` in `.gitignore`, and their changelog entries) ride along in this PR as their own `harness:` commit. The three Nits are fixed: `db:migrate` refuses an existing `APP_DB_USER` with `SUPERUSER`, `BYPASSRLS`, `CREATEROLE` or `CREATEDB`, and the API refuses to start on a login that is a superuser, has `BYPASSRLS` or owns tables; the pool logs a dropped idle connection instead of crashing; migration 0001 revokes `TEMPORARY` on the database from `PUBLIC`.
- **Review round 2 (Chris's decision: fix all, then review again).** All three reviewers passed; the security reviewer's further hardening is fixed. Both login checks also refuse `REPLICATION` and membership in another role; the startup check also refuses a login that owns schemas or may create schemas or temporary tables; every client gets an `error` listener, so a connection that dies while a request holds it doesn't crash the API; skill rules 5 and 6 name Kysely's unsafe `sql.*` helpers and tenant-scoped unique keys; the owner-login test reads the owner's name from the run, so `apps/api/src` again never spells it.
- **Review round 3 (Chris's decision: fix first, then review again).** All three passed. Fixed from the security reviewer: `resolveUser` casts its argument (`::uuid`), so a planted `app_resolve_user(text)` can't take over the login; the startup check also refuses `CREATE` in any schema and `TRUNCATE` on any table, reads `session_user`, and its hint names the database's grants; the owner tests assert the whole list of problems, so every branch is tested. From the bugs reviewer: the temporary-table problem says how to fix it, and the membership test creates its roles inside its `try`.
- **Carry into Phase 3.** Approving or rejecting must check, inside `withTenant`, that the caller's role is `approver` and that `requester_id` is not the caller (no self-approval), with a test for each. The schema doesn't enforce either.
- **Protected paths.** No change to `factory/checks.sh`, `factory/config.json` or `docker-compose.yml`. `protected_paths` (`factory/config.json`) lists only `factory/checks.sh`, `factory/config.json`, `factory/bin/*`, `REVIEW.md`, `.claude/hooks/*`, `.claude/settings.json`; none of this plan's files are in it.
