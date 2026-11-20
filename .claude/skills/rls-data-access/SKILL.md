---
name: rls-data-access
description: Tenant isolation with Postgres row-level security - how every query runs inside a tenant-scoped transaction, how to add a table with RLS policies, migration rules, and the isolation tests. Use when touching the database, a migration, a query, a repository/service that reads or writes tenant data, or when reviewing tenant isolation.
---

# RLS data access

**Tenant A can never read or write tenant B's data, and Postgres enforces it,
not only the application code.** Phase 2 built this with Kysely; the names below
are the real ones. The concepts are in `docs/LEARNING.md` (Phase 2 entries).

## The rules

1. **Every tenant table has a `tenant_id` (`tenants` uses `id`), and RLS is
   enabled and forced.** `FORCE` makes the owner subject to it too.
2. **The app connects as `levelpath_app`, which owns nothing.** It is not a
   superuser and has no `BYPASSRLS`; a superuser skips RLS even with `FORCE`, so
   the API never uses the owner's login (`apps/api/src/db/db-config.ts` doesn't
   even read it). Migrations and the seed run as the owner (`POSTGRES_USER`).
   It is checked, not trusted: the API refuses to start on a login that is a
   superuser, has `BYPASSRLS` or `REPLICATION`, is a member of another role, owns
   tables or schemas, may create schemas, objects in a schema or temporary
   tables, or may `TRUNCATE` a table (RLS doesn't cover `TRUNCATE`)
   (`DatabaseService.onModuleInit`, reading `session_user`). So a "permission
   denied" is fixed with a narrow `GRANT` in a new migration, never with
   `GRANT ALL`, `GRANT CREATE ON SCHEMA public` or a role membership: the API
   would refuse to start. `pnpm db:migrate` refuses an existing
   `APP_DB_USER` with any attribute or membership the role it creates doesn't have. The role
   can't create temporary tables either (migration 0001): one named like a real
   table would shadow it on that pooled connection.
3. **Every read and write of tenant data goes through `withTenant`.** It is the
   only door: `DatabaseService` (`apps/api/src/db/database.service.ts`) holds the
   one Kysely instance and its pool and exports nothing else that reaches them.

   ```ts
   @Injectable()
   export class SuppliersService {
     constructor(private readonly db: DatabaseService) {}

     list(user: AuthUser) {
       return this.db.withTenant(user.tenantId, (trx) =>
         trx.selectFrom('suppliers').select(['id', 'name']).execute(),
       );
     }
   }
   ```

   `withTenant` opens a transaction and runs
   `select set_config('app.tenant_id', $1, true)` first. `true` means LOCAL: the
   setting ends with the transaction, on commit or rollback. A session-wide `SET`
   would ride along on the pooled connection into the next request, which is the
   connection-pool leak. Never set the tenant any other way, never open a
   connection of your own, never run tenant queries on `trx` after `fn` returns.
4. **The tenant comes from `@CurrentUser()`** (the `AuthGuard`'s resolved user),
   never from a body, query string or path parameter.
5. **No user input in raw SQL.** RLS catches a forgotten `where`, not an
   injection: any SQL that runs as the app role could call `set_config` itself.
   Build queries with Kysely's query builder or `sql` template parameters, never
   by concatenation. Kysely's `sql.raw`, `sql.lit`, `sql.ref`, `sql.table` and
   `sql.id`, and `trx.dynamic.ref`, put their argument into the SQL text: never
   pass them user input. A column the client picks (a sort, a filter) goes
   through a fixed list first. When raw SQL calls a function, cast its arguments
   (`${id}::uuid`), so Postgres can only pick the function you mean.
6. **Writes don't reveal other tenants' keys.** RLS hides rows, not whether a key
   exists: inserting another tenant's id fails on the primary key. Never accept a
   client-chosen `id` (Postgres generates them), and answer a unique (`23505`) or
   foreign-key (`23503`) violation the same way as "not found". Every other
   unique constraint starts with `tenant_id` (`UNIQUE (tenant_id, name)`), or it
   tells tenant A which names tenant B uses, and blocks A from using them.

The single exception is the stub login's lookup, `resolveUser(userId)`, which
calls `public.app_resolve_user(uuid)`: a `SECURITY DEFINER` function that
returns one user's id, tenant and role. Don't add a second one; don't turn RLS
off on a table.

## The policy

```sql
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
```

`current_setting(..., true)` is NULL when the tenant was never set. After a
transaction that set it, Postgres leaves `''` behind on that connection, and
`''::uuid` would raise an error; `NULLIF` makes it NULL. NULL matches no row, so a
missing tenant fails closed: every table looks empty.

## Adding a tenant table

A new file `db/migrations/000N_<name>.sql` (plain SQL, no `BEGIN`/`COMMIT`: the
runner wraps each file in a transaction and records it in `schema_migrations`).
Never edit a migration that is on `main`; the guard hook blocks it.

```sql
CREATE TABLE public.line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  purchase_request_id uuid NOT NULL,
  description text NOT NULL,
  UNIQUE (tenant_id, id),
  -- Foreign-key checks bypass RLS: reference the parent with the tenant included.
  FOREIGN KEY (tenant_id, purchase_request_id) REFERENCES public.purchase_requests (tenant_id, id)
);
ALTER TABLE public.line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.line_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.line_items TO {{app_role}};
```

- `{{app_role}}` is filled in by the runner. Grant only what the app needs.
- Every reference to another tenant table is composite, `(tenant_id, x_id)`,
  against a `UNIQUE (tenant_id, id)` on the parent.
- Add the table's type to `apps/api/src/db/schema.ts` (`Generated<>` for columns
  Postgres fills in) and any value list to `packages/shared/src/values.ts`.
- Apply it: `pnpm db:migrate` (the dev database); the tests migrate their own.

## The isolation tests (required for every tenant table)

Against the real database, never mocked. Add the table to `TENANT_TABLES` in
`apps/api/test/helpers.ts` (and to the writable tables in
`apps/api/src/db/rls-isolation.spec.ts` when the app may write it); the existing
cases then cover it:

- from `withTenant(A)`, B's rows are invisible, even by B's exact id;
- `UPDATE` and `DELETE` of B's row affect 0 rows, and B's row is unchanged;
- `INSERT` with `tenant_id = B`, or moving A's row to B, fails the `WITH CHECK`;
- a plain app-role connection, outside `withTenant`, sees nothing;
- a cross-tenant reference fails the composite foreign key.

Helpers (`apps/api/test/helpers.ts`): `databaseService()` (as the app role),
`ownerClient()` (sees everything: to check what really happened),
`appRoleClient()` (no tenant set), `startApp()` (the real app over HTTP), and
`SEED` (the fixed ids of `db/seed.sql`: Acme `a0000000-…`, Globex `b0000000-…`).

## Running them

`pnpm db:up` first. Vitest's global setup (`apps/api/test/global-setup.mjs`)
creates a database `lp_<random>` for the run, migrates and seeds it, and drops
it at the end, so parallel runs in worktrees never share rows. Without Postgres
the run fails with "Run `pnpm db:up` first"; database tests are never skipped.
