# Tenancy and RLS foundation: five tenant tables, forced RLS, `withTenant`, stub auth

> Issue: none · Type: feature · Intent: docs/intent/tenancy-rls-foundation.md · Risk: high · Surfaces: api, db, security

<!-- WHAT and HOW TO CHECK IT. Written by the planner. The builder tests against the acceptance criteria, the verifier exercises them, reviewer-spec traces them to the diff, the approver checks them. -->

## Summary

- Postgres gets the five tables (`tenants`, `users`, `suppliers`, `purchase_requests`, `approvals`) as plain numbered `.sql` migrations in `db/migrations/`, with row-level security enabled **and forced** on every one, plus seed data for two tenants.
- The API connects as a separate **non-owner** role. All data access goes through one helper, `withTenant`, which opens a transaction and runs `set_config('app.tenant_id', …, true)` first, so a pooled connection can never carry one tenant's context into the next request.
- An `X-User-Id` stub auth guard resolves a seeded user to tenant and role. It is global and fails closed. It is a dev stub, and the docs say so.
- An integration suite against the real database and real policies proves tenant A cannot select, update, delete or insert into tenant B's rows (even by crafted id), and that a query outside `withTenant` sees nothing.
- Each test run creates its own throwaway database, so parallel runs and worktrees don't collide.

## Context

Today the repo has no database code at all:

- `db/` holds only `.gitkeep`. `docker-compose.yml` runs `postgres:18-alpine`; `POSTGRES_USER` (`levelpath_owner`) is the image's owner and superuser. `.env.sample` already says "From Phase 2 the app connects as a separate NON-owner role".
- `apps/api` (NestJS 12, ESM-only, Vitest) has only `HealthController` and `VersionController` (`apps/api/src/health.*`, `version.*`) registered in `apps/api/src/app.module.ts`. Vitest runs `src/**/*.spec.ts` (`apps/api/vitest.config.ts`). It has no database dependency and does not depend on `packages/shared`.
- `packages/shared/src/index.ts` is a placeholder.
- `factory/checks.sh` (install, build, lint, test) is **protected** (`factory/config.json` `protected_paths`) and does not start Postgres or create a database. The per-run database therefore has to be created by the test setup itself, not by `checks.sh`.
- `db/migrations/` is guarded: `.claude/hooks/guard.py` blocks edits to a migration already on the base branch. Migrations added by this job are new files.
- The conventions to follow are in `.claude/skills/rls-data-access/SKILL.md` and `.claude/skills/nestjs-endpoint/SKILL.md`; the Kysely decision is in `docs/LEARNING.md`.

## Requirements

**Schema and migrations**

1. `db/migrations/` holds plain numbered `.sql` files (`0001_….sql`, `0002_….sql`, …). They run as the **owner** role, in order, each in a transaction.
2. A small migration runner (`pnpm db:migrate`) applies, in filename order, only the files not yet applied, and records each applied filename in a `schema_migrations` table. Re-running it applies nothing. The same runner code is used by the test setup. The app role has no privileges on `schema_migrations`.
3. The runner ensures the **app role** exists (default `levelpath_app`, password from env) before the migrations that grant to it. Creating it is idempotent and safe when several runs do it at once on the same Postgres server (roles are server-wide, not per database). The app role is not a superuser, does not own any table, has no `BYPASSRLS`, and cannot create objects.
4. Five tables, UUID primary keys with `DEFAULT gen_random_uuid()`:
   - `tenants` (`id`, `name`, `created_at`).
   - `users` (`id`, `tenant_id`, `name`, `role` in `requester | approver`, `created_at`).
   - `suppliers` (`id`, `tenant_id`, `name`, `created_at`).
   - `purchase_requests` (`id`, `tenant_id`, `requester_id`, `supplier_id`, `title`, `amount_cents` (bigint, `>= 0`), `currency` (text, default `'EUR'`), `status` in `draft | submitted | approved | rejected` default `draft`, `created_at`, `updated_at`).
   - `approvals` (`id`, `tenant_id`, `purchase_request_id`, `approver_id`, `decision` in `approved | rejected`, `comment`, `decided_at`).
5. Every table above has row-level security **enabled and forced**, with a `tenant_isolation` policy that has both `USING` and `WITH CHECK`. `tenants` is keyed on `id`; the other four on `tenant_id`. The policy reads the tenant with `NULLIF(current_setting('app.tenant_id', true), '')::uuid`. The `NULLIF` is required: after a transaction that used `SET LOCAL`, Postgres leaves `app.tenant_id` defined as an empty string on that connection, and a bare `''::uuid` cast would make a query error instead of match nothing. With the setting missing or empty, the policy matches no rows (fails closed).
6. The app role is granted `SELECT` only on `tenants` and `users`, and `SELECT, INSERT, UPDATE, DELETE` on `suppliers`, `purchase_requests` and `approvals`, and nothing else, so it can't read `schema_migrations` or any other table. The app never creates, changes or deletes a company or a user: sign-up and user management are out of scope (Chris's decision on review of this spec).
7. A row can't point at another tenant's row through a foreign key. Foreign key checks bypass RLS, so the references are composite, `(tenant_id, x_id)` against a `UNIQUE (tenant_id, id)` on the parent: `users.tenant_id`, `suppliers.tenant_id`, `purchase_requests` to `users` (requester) and `suppliers`, and `approvals` to `purchase_requests` and `users` (approver).

**Seed data**

8. `pnpm db:seed` loads `db/seed.sql` as the owner. It is idempotent (running it twice leaves the same rows) and uses the fixed ids below, so the docs, tests and verifier can refer to them. Two tenants, each with one requester, one approver, two suppliers, purchase requests in all four statuses, and an approval row for each approved or rejected request.

   | Row                      | Id                                     |
   | ------------------------ | -------------------------------------- |
   | Tenant "Acme Corp"       | `a0000000-0000-4000-8000-000000000001` |
   | Acme requester "Alice"   | `a0000000-0000-4000-8000-000000000101` |
   | Acme approver "Amir"     | `a0000000-0000-4000-8000-000000000102` |
   | Tenant "Globex Corp"     | `b0000000-0000-4000-8000-000000000001` |
   | Globex requester "Bella" | `b0000000-0000-4000-8000-000000000101` |
   | Globex approver "Boris"  | `b0000000-0000-4000-8000-000000000102` |

   Ids of the other seeded rows are the builder's choice, in the same fixed style.

**API**

9. `apps/api` uses Kysely (with the `pg` driver) as the query layer, with hand-written table types. No ORM, no generated migrations, no code generation.
10. One `withTenant(tenantId, fn)` helper (in an injectable database service) is the **only** way the application code gets a database handle. It checks `tenantId` is a UUID (throws otherwise), opens a transaction, runs `select set_config('app.tenant_id', $1, true)` as the first statement, runs `fn` with the transaction, and commits (or rolls back and rethrows on error). The setting is transaction-local: it is never set at session scope.
11. The Kysely instance and pool are not exported or injectable anywhere else. The only other thing that reaches the database is the user lookup in requirement 12, and it exposes nothing that lists or reads other tenants' data.
12. The API connects as the app role, never the owner. Connection settings come from environment variables with defaults that match `docker-compose.yml`; `.env.sample` lists them (owner and app role user and password, host, port, database).
13. The `X-User-Id` stub guard is registered globally. For every route except those marked public, it takes the header, requires a UUID, and resolves it to `{ userId, tenantId, role }` using a lookup that returns the id, tenant id and role of exactly one user for one given id. A missing, malformed or unknown id gives `401`. The lookup must not give the app role a way to list users across tenants and must not turn off RLS on `users`. The mechanism is the plan's call.
14. `/health` and `/version` stay public (a `@Public()` marker or equivalent). Any route added later is protected by default.
15. The resolved user is put on the request context and read through a decorator. A tenant id, user id or role is never taken from a body, query string or path parameter.
16. One minimal protected route, `GET /me`, returns `{ user: { id, name, role }, tenant: { id, name } }` for the caller, with both rows read through `withTenant`. It exists to prove the guard and `withTenant` work end to end. It is the only new route.

**Tests**

17. Integration tests run against a real Postgres with the real migrations, seed and policies. Nothing about the database or RLS is mocked. A Vitest global setup creates a database named `lp_<random>` for the run, applies the migrations and seed as the owner, and drops the database at the end (even when tests fail). The tests connect as the app role.
18. If Postgres is unreachable, the tests **fail** with a message that says to run `pnpm db:up`. They never skip silently.

**Docs**

19. Docs are updated (see Acceptance criteria 23 to 26).

## Acceptance criteria

Commands assume Postgres is up (`pnpm db:up`) and run from the repo root.

1. **Migrations apply once.** On an empty database, `pnpm db:migrate` exits 0 and lists the applied files. Running it again exits 0 and reports nothing to apply. `select filename from schema_migrations` as the owner lists each file once. There are only the five tenant tables, `schema_migrations`, and nothing else under `public`.
2. **RLS is forced everywhere.** A test queries `pg_class` and asserts `relrowsecurity` and `relforcerowsecurity` are both true for exactly `tenants`, `users`, `suppliers`, `purchase_requests` and `approvals`, and that every one has a policy with both `qual` and `with_check` set in `pg_policies`.
3. **The app role is locked down.** A test, connected as the app role, asserts in `pg_roles` that it is not a superuser, has no `bypassrls`, owns none of the five tables, and holds only `SELECT` on `tenants` and `users` (`information_schema.role_table_grants`). It also asserts `select * from schema_migrations` fails with "permission denied" and `create table x()` fails.
4. **Seed is idempotent.** `pnpm db:seed` twice leaves identical row counts (2 tenants, 4 users, 4 suppliers, purchase requests in all four statuses for each tenant, approvals for each approved and rejected one). The six fixed ids in requirement 8 exist.
5. **Select isolation.** For each of the five tables, in a `withTenant(A)` transaction, `select` of tenant B's rows returns 0 rows, both with no filter and by B's exact id. `withTenant(B)` sees B's rows and none of A's.
6. **Update isolation.** For `suppliers`, `purchase_requests` and `approvals`, in `withTenant(A)`, `update … where id = <B's id>` affects 0 rows, and B's row is unchanged when read back as the owner. Changing `tenant_id` on one of A's own rows to B's tenant fails the `WITH CHECK`. For `tenants` and `users`, any `update` from `withTenant(A)`, even of A's own row, fails with "permission denied".
7. **Delete isolation.** For `suppliers`, `purchase_requests` and `approvals`, in `withTenant(A)`, `delete … where id = <B's id>` affects 0 rows, and B's row still exists when read back as the owner. For `tenants` and `users`, any `delete` from `withTenant(A)` fails with "permission denied".
8. **Insert isolation.** For `suppliers`, `purchase_requests` and `approvals`, in `withTenant(A)`, inserting a row with `tenant_id = B` fails with a row-level-security violation, and inserting with `tenant_id = A` succeeds. For `tenants` and `users`, any `insert` from `withTenant(A)` fails with "permission denied".
9. **Cross-tenant references are rejected.** As the owner, inserting a `purchase_requests` row with `tenant_id = A` but B's `supplier_id` fails on the composite foreign key. The same holds for `requester_id`, and for an `approvals` row pointing at B's purchase request or approver.
10. **Outside `withTenant` sees nothing.** A raw connection as the app role, with no transaction setup, gets 0 rows from each of the five tables. Inside a transaction that sets `app.tenant_id` to an empty string, the result is also 0 rows, not an error.
11. **No pool leak.** With a pool limited to a single connection, run `withTenant(A)` and read A's rows, then run a plain query on the same connection outside any `withTenant`. The second query returns 0 rows (not an error, not A's rows). A second `withTenant(B)` on the same connection returns only B's rows. A failing `fn` rolls back and the connection is reusable afterwards. A test also asserts `current_setting('app.tenant_id', true)` is null or empty after `withTenant` returns.
12. **`withTenant` guards its input.** `withTenant('not-a-uuid', …)` and `withTenant('', …)` throw before any query runs. The helper is the first statement of its transaction (checked by logging the SQL that runs).
13. **Auth guard, rejects.** `GET /me` with no `X-User-Id` returns 401; with `X-User-Id: not-a-uuid` returns 401; with a well-formed id that matches no user returns 401. None of the responses reveal whether a user exists.
14. **Auth guard, accepts.** `GET /me` with `X-User-Id: a0000000-0000-4000-8000-000000000101` returns 200 and `{ "user": { "id": "a0000000-0000-4000-8000-000000000101", "name": "Alice", "role": "requester" }, "tenant": { "id": "a0000000-0000-4000-8000-000000000001", "name": "Acme Corp" } }`. With Globex's approver id (`b0000000-0000-4000-8000-000000000102`) it returns Boris, role `approver`, Globex Corp.
15. **The client can't choose the tenant.** `GET /me` as Alice with `?tenantId=<Globex id>` and with an `X-Tenant-Id: <Globex id>` header still returns Acme Corp.
16. **The guard doesn't open a hole.** As the app role with no tenant set, `select * from users` returns 0 rows (the lookup does not turn RLS off), and no function the app role can execute returns users for more than one id.
17. **Public routes stay public.** `GET /health` returns `{"status":"ok"}` and `GET /version` returns the version, both without `X-User-Id`. The existing health and version tests still pass unchanged.
18. **Per-run databases.** Two `pnpm --filter @levelpath/api test` runs started at the same time both pass: each created its own `lp_<random>` database, and no `lp_*` database is left behind afterwards (`select datname from pg_database where datname like 'lp\_%'` is empty).
19. **Fails loudly without Postgres.** With Postgres stopped (`pnpm db:down`), `pnpm --filter @levelpath/api test` exits non-zero and the output mentions `pnpm db:up`. It does not report the database tests as skipped or passed.
20. **Gate.** `bash factory/checks.sh` exits 0 with Postgres up: build, lint, and all tests green, including the new integration suite.
21. **No secrets, no owner at runtime.** No password or `.env` value is written into a source file other than the documented dev defaults that already appear in `docker-compose.yml` and `.env.sample`. `rg -n "levelpath_owner" apps/api/src` finds the owner role only in test setup, never in the running API's connection code.
22. **Dependencies are checked, not remembered.** The versions of `kysely`, `pg` and `@types/pg` in `apps/api/package.json` are ones that `pnpm view <pkg> dist-tags peerDependencies` reported at planning time, and `pnpm build` and `pnpm test` pass with them on Nest 12 (ESM).
23. **Docs: the risk and the design.** `docs/LEARNING.md` has entries (What, Why it matters, Where) for: RLS with `FORCE`, the non-owner app role (and that a superuser or owner bypasses RLS), the transaction-local tenant setting and how it avoids the connection-pool leak, and the composite-foreign-key point.
24. **Docs: the stub is not auth.** `README.md` or `CLAUDE.md` and `docs/LEARNING.md` say in plain words that `X-User-Id` is a dev stub, anyone can send any id, and real authentication is not built.
25. **Docs: the skill is real.** `.claude/skills/rls-data-access/SKILL.md` names the real helpers (`withTenant`, the database service, the migration and seed commands, the `NULLIF` policy form, the per-run database setup) instead of "Phase 2 will choose". `.claude/skills/nestjs-endpoint/SKILL.md` names the real guard, `@Public()` marker and request decorator.
26. **Docs: commands.** `CLAUDE.md` adds `pnpm db:migrate`, `pnpm db:seed`, the "tests need Postgres up (`pnpm db:up`)" line and `db/` and `apps/api` layout, and `.env.sample` lists the new variables.

## Tenant isolation and security

- **Enforced in Postgres.** The five tables have RLS enabled and forced; the app connects as a non-superuser, non-owner, non-`BYPASSRLS` role. Policies fail closed when the tenant is missing or empty.
- **Least privilege.** The app can only read `tenants` and `users`. Writing them needs the owner, so no request can create, change or delete a company or a user, in any tenant. The RLS policies on those two tables still limit what the app reads.
- **Tenant context is transaction-local.** `withTenant` is the single door to the database and sets the tenant with `set_config(..., true)` as the first statement of its transaction. A pooled connection is clean again after commit or rollback.
- **Superuser caveat.** The image's `POSTGRES_USER` is a superuser and bypasses RLS even with `FORCE`. That is why the API must never connect as the owner (criterion 21), and why the tests connect as the app role. This goes in the docs.
- **Cross-tenant references.** RLS does not cover foreign-key checks, so composite keys close that gap (requirement 7).
- **The user lookup is the narrowest possible exception.** It is the one place that reads a user before the tenant is known. It takes one id and returns one user's id, tenant id and role. It must not widen the app role's reach (criterion 16).
- **Stub auth is trust-the-header.** It is for the demo only, and the docs say so. It still validates its input (UUID format, no SQL string building) and returns the same 401 for "no such user" and "bad id".
- **Input and logging.** All SQL goes through Kysely or parameters, never string concatenation. Errors are logged with context and rethrown; no `catch {}`. No user names or ids from `X-User-Id` are written to logs beyond what a request log already holds.
- **Migrations** only add files. No existing migration is edited (there are none yet), and nothing loses data.

## Out of scope

- Purchase-request create, submit and approve endpoints and screens (Phase 3), and any web change.
- The LLM suggestion feature (Phase 4).
- Real authentication: passwords, sessions, tokens, user management, tenant sign-up.
- CI changes (Phase 5), and any change to `factory/checks.sh`, `factory/config.json` or other `protected_paths`.
- Zod request validation pipes and DTOs for routes that don't exist yet. (A UUID check on the header is enough.)
- Code generation for Kysely types, seed factories, an ORM, role-based route permissions, soft delete, audit columns, or extra tables and columns beyond the five tables above.
- Changing `docker-compose.yml`.
- Reading or editing any `.env` file.

## Assumptions

- **Postgres must be up for `pnpm test`.** `factory/checks.sh` is protected and can't start it, so the integration tests live in the normal `pnpm test` run and fail loudly with a hint when the database is down (criterion 19). Anyone running the gate runs `pnpm db:up` first.
- **Per-run database created by test setup.** The intent and `rls-data-access` skill say `factory/checks.sh` creates `lp_<run>`. It can't be changed, so a Vitest global setup creates `lp_<random>` instead and drops it on exit.
- **App role created by the migration runner, not a migration file.** Roles are server-wide, so a plain SQL migration would race and fail when per-run databases are created in parallel. The runner creates it idempotently under a lock; the migrations (as the owner) grant to it. Default name `levelpath_app`, with a dev-only default password documented in `.env.sample`.
- **Every tenant table has `tenant_id`, `tenants` uses `id`.** Approvals carry their own `tenant_id` so their policy is the same simple form and no join is needed.
- **Column choices not in the intent:** `amount_cents` as a bigint with a `currency` text column defaulting to `EUR`; `title` as the only free-text field on a purchase request; `decision` and `comment` on approvals. Phase 3 can add columns by new migration.
- **The user lookup uses a dedicated mechanism.** The plan chooses between a narrow `SECURITY DEFINER` function (with a fixed `search_path`) and a second, id-scoped `SELECT` policy on `users`, and says why. This spec only fixes what it may expose (requirement 13).
- **`GET /me` is the only new route.** Some route is needed to exercise the guard and `withTenant` end to end; this is the smallest one. Phase 3 replaces it as the demo of the pattern.
- **The guard is global, public routes opt out.** This fails closed for future routes at the cost of marking `/health` and `/version`.
- **Role and status value lists** (`requester | approver`, `draft | submitted | approved | rejected`) are defined once in `packages/shared` if the plan wires `apps/api` to it; otherwise they are defined once in the API. The plan decides which, without adding Zod unless something uses it.
- **Seed ids are fixed** so docs, tests and the verifier can name them. They are demo data, not secrets.
