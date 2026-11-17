---
name: rls-data-access
description: Tenant isolation with Postgres row-level security - how every query runs inside a tenant-scoped transaction, how to add a table with RLS policies, migration rules, and the isolation tests. Use when touching the database, a migration, a query, a repository/service that reads or writes tenant data, or when reviewing tenant isolation.
---

# RLS data access

**Tenant A can never read or write tenant B's data, and Postgres enforces it,
not only the application code.** These are the conventions. Phase 2 builds
them, chooses the query layer (Drizzle, Kysely, TypeORM or Prisma), and
updates this skill with the real helper names.

## The four rules

1. **Every tenant table has a `tenant_id`, and RLS is enabled and forced.**
   `FORCE` matters: without it the table owner bypasses the policies.
2. **The app connects as a non-owner role.** Migrations run as the owner
   (`POSTGRES_USER`); the API's role owns nothing, so RLS always applies to it.
3. **Every query runs in a transaction that sets the tenant first:**

   ```sql
   BEGIN;
   SELECT set_config('app.tenant_id', $1, true);  -- true = LOCAL: this transaction only
   -- the queries
   COMMIT;
   ```

   Never `SET app.tenant_id` without `LOCAL`. The pool hands the same
   connection to the next request, which would then run as the previous
   tenant. That is the connection-pool leak, and the transaction scope is the
   fix. In code, a single helper (`withTenant(tenantId, tx => …)`) is the only
   way to get a connection.
4. **The tenant id comes from the authenticated request context**, never from a
   body, query string or path parameter.

## Adding a tenant table

A new migration file (never edit one that is already on `main`; the guard
hook blocks it):

```sql
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppliers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers TO <app role>;
```

`current_setting(..., true)` returns NULL when the tenant isn't set, so the
policy matches nothing. A missing tenant fails closed.

## The isolation tests (required for every tenant table)

Against the real database (never mocked), with two seeded tenants:

- From tenant A's context, `SELECT` tenant B's rows returns nothing, even by
  B's exact id.
- `UPDATE` and `DELETE` of B's row by id affect 0 rows.
- `INSERT` with `tenant_id = B` fails the `WITH CHECK`.
- A query outside `withTenant` sees nothing.

## Parallel runs

The factory and the ADWs build in parallel worktrees. Integration tests that
create tenants would collide in one shared database, so Phase 2 gives each run
its own database (`lp_<run>`), created in `factory/checks.sh`.
