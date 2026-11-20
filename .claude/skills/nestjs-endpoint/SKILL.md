---
name: nestjs-endpoint
description: How to add or change an HTTP endpoint in apps/api (NestJS 12, ESM) - module, controller, service, request validation, guards, errors and the tests every endpoint needs. Use when creating or modifying a NestJS controller, route, service, module, DTO or guard, or when reviewing such a change.
---

# NestJS endpoint

`apps/api` is a NestJS 12 app. Nest 12 is **ESM-only**: relative imports end
in `.js` (`import { HealthService } from './health.service.js'`) even though the
files are `.ts`. Tests run on Vitest, whose Oxc transform emits the decorator
metadata dependency injection needs (verified in Phase 0, `docs/LEARNING.md`).
The patterns to copy: `src/health.*` for a public route, `src/me/*` for a
protected one that reads tenant data.

## Shape of a feature

One folder per feature under `apps/api/src/<feature>/`:

```
<feature>.module.ts        @Module({ controllers, providers }) - imported by app.module.ts
<feature>.controller.ts    routes only: parse, call the service, return
<feature>.service.ts       the logic; the only place that touches data
<feature>.controller.spec.ts / <feature>.service.spec.ts
```

- **Controllers stay thin.** `@Controller('purchase-requests')`, one method per
  route (`@Get()`, `@Post()`, `@Param('id')`, `@Body()`), no business rules.
- **Services get their dependencies through the constructor** (DI). Never
  `new` a service; never reach for globals.
- **Register** the module in `app.module.ts`.

## Validate every input

Request bodies, params and query strings are validated before the controller
uses them. The schemas live in `packages/shared` (Zod), so the web app
validates with the same rules. Parse a body with the pipe in
`src/validation/zod-validation.pipe.ts`:
`@Body(new ZodValidationPipe(createPurchaseRequestSchema))`. The route gets the
parsed output (trimmed, defaults filled in); a failure, or no body, is a 400
`{ statusCode, message, issues: [{ path, message }] }`. A path id is checked with
`isUuid` (`src/db/uuid.ts`) in the service, and a non-UUID is a 404: not
`ParseUUIDPipe`, which answers 400.

Never trust a tenant id, user id or role sent by the client: they come from
the request context that the auth guard sets.

## Auth: protected by default

- **`AuthGuard`** (`src/auth/auth.guard.ts`) is global (`APP_GUARD` in
  `src/auth/auth.module.ts`): every route needs `X-User-Id` with a seeded user's
  id, or it answers 401. It is a **dev stub, not authentication**; say so
  wherever it shows.
- **`@Public()`** (`src/auth/public.decorator.ts`) on a controller or route
  opens it. Only `/health` and `/version` have it.
- **`@CurrentUser()`** (`src/auth/current-user.decorator.ts`) gives the route
  the caller as `AuthUser` (`userId`, `tenantId`, `role`). Pass it to the service,
  which uses `user.tenantId` for `withTenant`.

```ts
@Get()
list(@CurrentUser() user: AuthUser) {
  return this.suppliers.list(user);
}
```

- **`ApproverGuard`** (`src/auth/approver.guard.ts`) on a route,
  `@UseGuards(ApproverGuard)`, answers 403 unless the caller is an approver.
  Nest runs guards before pipes, so the role is checked before the body is
  parsed or any id looked up: a requester gets the same 403 for every input.

## Data and tenants

The service never opens its own connection. Every query runs inside
`DatabaseService.withTenant(user.tenantId, trx => …)` (the `rls-data-access`
skill), so Postgres RLS applies. Import `DatabaseModule` in the feature module. An id that belongs to another tenant must behave like an id that
doesn't exist: 404, never 403, so the response doesn't leak that it exists.

## Errors

Throw Nest's HTTP exceptions (`NotFoundException`, `BadRequestException`,
`ForbiddenException`). Never swallow an error: log it with context (never
personal data) and rethrow, or return a typed error. No `catch {}`.

## Tests every endpoint needs

- **Service:** the logic, with the real database where it queries (no mocked
  database or RLS; the LLM provider is the only allowed fake).
- **Controller, over real HTTP:** `startApp()` from `apps/api/test/helpers.ts`
  starts the whole app on a free port against this run's database; call it with
  `fetch` and `X-User-Id: <SEED id>`. Cover the happy path, no header → 401,
  invalid input → 400, unknown id → 404. See `src/me/me.controller.spec.ts`.
- **Tenant isolation:** for every route that reads or writes tenant data,
  tenant B's id from tenant A's context fails (see `rls-data-access`).

Run `pnpm db:up`, then `pnpm --filter @levelpath/api test`, then
`bash factory/checks.sh`.

## Checklist

1. Module, controller, service in `src/<feature>/`, registered in `app.module.ts`.
2. Imports end in `.js`.
3. Every input validated by a shared Zod schema.
4. Tenant and user come from `@CurrentUser()`, never the body; the route is
   not `@Public()` unless it truly is.
5. Data access only through the tenant transaction.
6. Tests: happy path, 400, 404, cross-tenant.
7. `CLAUDE.md` updated if you added a command or convention.
