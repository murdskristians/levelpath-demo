# Plan: API: purchase requests from draft to decision

> Spec: factory/jobs/002-api-purchase-requests-from/spec.md · Type: feature

<!-- HOW. Written by the planner after the spec. Sections marked (feature), (bug) or (chore) apply to that type only. -->

## Approach

Two feature folders follow the `me/` pattern (a thin controller, a service that does everything inside `withTenant`): `suppliers/` and `purchase-requests/`. Three small shared pieces support them:

- `ZodValidationPipe`: parses a body with a shared schema and turns a failure into the contract's 400 with `issues`.
- `ApproverGuard`: a route guard, so the role check runs after the global `AuthGuard` and before the body pipe. Nest runs guards before pipes, and that gives the check order spec requirement 13 asks for.
- `isKeyViolation`: recognises `23503`/`23505`, so a bad `supplierId` answers 404.

One query builder reads a request with its supplier, its requester and its latest approval (a lateral join), and one mapper turns the row into the shared `PurchaseRequest` type. Every route reuses both.

Submit and decide first read the row to pick the right error (404, 403, 409), then change the status with an `UPDATE … WHERE status = <expected>`. If it updates no row, the answer is 409. That closes the read-then-write race without a migration. A unique key on `approvals.purchase_request_id` would also need edits to the pinned grant and table tests, and intake allows a migration only if one is truly needed.

Why not a global `ValidationPipe` or exception filter: the contract's bodies are Zod schemas, not class-validator DTOs, and a global filter would change the error bodies of `/me` and the 401 that `auth.guard.spec.ts` pins. Nest's own exception bodies (`{"message":"Not Found","statusCode":404}`) already fit `apiErrorSchema`.

## Libraries and versions

Checked on 2026-11-20 with `pnpm view` and the installed `node_modules` in the main checkout:

- **zod**: `latest` 4.6.7, `"type": "module"` (ESM), no peer dependencies. It is **added** to `apps/api` `dependencies` as `"zod": "^4.6.7"`, the same specifier as `packages/shared`, so pnpm resolves the one 4.6.7 already in the lockfile. Only the pipe imports it, and only for types (`import type { ZodType } from 'zod'`). Run `pnpm install` so `pnpm-lock.yaml` gets the `apps/api` importer entry. The gate runs `--frozen-lockfile`, so commit the updated lockfile.
- **@nestjs/common / core / platform-express**: 12.4.2 installed (`latest` 12.6.0). ESM-only, relative imports end in `.js`. Peers: `rxjs ^7.1.0`, `reflect-metadata ^0.1.12 || ^0.2.0`. `class-validator` and `class-transformer` are optional peers and are **not** used. `platform-express` 12.4.2 bundles `express` 5.3.0, so with no body `@Body()` is `undefined`. No version change.
- **kysely**: 0.29.9 (`latest`), ESM. Relied on: `leftJoinLateral(…, (join) => join.onTrue())` (both are in the installed `.d.ts`), `eb.or`, `returning`, `sql` with no input for `now()`. No change.
- **pg**: 8.23.1. `pg.DatabaseError` is exported from the default import (checked: `typeof pg.DatabaseError === 'function'`), and `.code` holds the SQLSTATE. No change.
- **vitest**: ^5.1.0 (existing). No change.

## Files

- `apps/api/package.json`: add `"zod": "^4.6.7"` to `dependencies`.
- `pnpm-lock.yaml`: updated by `pnpm install` (the `apps/api` importer gains `zod`).
- `apps/api/src/app.module.ts`: import `SuppliersModule` and `PurchaseRequestsModule`.
- `apps/api/test/helpers.ts`: add `deleteRowsTestsCreated(owner)` and `seededRequestsSnapshot(owner)` (see step 4). Read the whole file first.
- `.claude/skills/nestjs-endpoint/SKILL.md`: replace the two "Zod and the validation pipe are not wired yet" passages with the real pipe (`apps/api/src/validation/zod-validation.pipe.ts`) and `ApproverGuard` (`apps/api/src/auth/approver.guard.ts`). Note that guards run before pipes.
- `docs/LEARNING.md`: two Phase 3 entries (step 6).
- `CLAUDE.md`: in Architecture, one line for `apps/api/src/suppliers/` and `apps/api/src/purchase-requests/`, the pipe and the approver guard.

### New files

- `apps/api/src/validation/zod-validation.pipe.ts`: `ZodValidationPipe<T>` for `@Body(...)`.
- `apps/api/src/validation/zod-validation.pipe.spec.ts`: unit tests of the issue mapping (no database needed).
- `apps/api/src/auth/approver.guard.ts`: `ApproverGuard`, which throws `ForbiddenException` unless `request.authUser.role === 'approver'`.
- `apps/api/src/db/pg-errors.ts`: `isKeyViolation(err: unknown): boolean`.
- `apps/api/src/suppliers/suppliers.module.ts`, `suppliers.controller.ts`, `suppliers.service.ts`, `suppliers.controller.spec.ts`.
- `apps/api/src/purchase-requests/purchase-requests.module.ts`, `purchase-requests.controller.ts`, `purchase-requests.service.ts`.
- `apps/api/src/purchase-requests/purchase-request.query.ts`: `selectPurchaseRequests(trx)` and `toPurchaseRequest(row)`.
- `apps/api/src/purchase-requests/lists.spec.ts` (mine, to-decide), `create.spec.ts`, `submit.spec.ts`, `decision.spec.ts`: HTTP tests against the real database.

## Steps

### 1. Dependency and shared helpers

- Add `zod` to `apps/api/package.json`, then `cd <worktree> && pnpm install` (it updates `pnpm-lock.yaml`) and `pnpm --filter @levelpath/shared build` (the API imports `@levelpath/shared` from `dist/`).
- `apps/api/src/validation/zod-validation.pipe.ts`:

  ```ts
  @Injectable()
  export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
    constructor(private readonly schema: ZodType<T>) {}
    transform(value: unknown): T {
      const result = this.schema.safeParse(value);
      if (result.success) return result.data;
      throw new BadRequestException({
        statusCode: 400,
        message: 'Invalid request body',
        issues: result.error.issues.map((i) => ({
          path: i.path.map(String).join('.'),
          message: i.message,
        })),
      });
    }
  }
  ```

  `new BadRequestException(object)` uses the object as the body unchanged (checked). It is a typed error, not a swallowed one.

- `zod-validation.pipe.spec.ts`: with `createPurchaseRequestSchema` and `decisionSchema` from `@levelpath/shared`:
  - a valid body returns the parsed output (`currency` filled in as `EUR`, `title` trimmed);
  - `{ ..., id }` throws a `BadRequestException` whose response has `statusCode: 400` and an issue with `path: ''`;
  - `undefined` throws with an issue at `path: ''`;
  - an empty `title` has `path: 'title'`;
  - `{ decision: 'rejected' }` has `path: 'comment'`;
  - the response parses with `apiErrorSchema`.
- `apps/api/src/auth/approver.guard.ts`: `@Injectable() class ApproverGuard implements CanActivate`. It reads `context.switchToHttp().getRequest<AuthedRequest>().authUser`. It throws `new ForbiddenException()` (body `{"message":"Forbidden","statusCode":403}`) unless `role === 'approver'`. A missing `authUser` can only be a programming error (the global guard always sets it first), so it throws a plain `Error`, as `current-user.decorator.ts` does. A comment says it is used with `@UseGuards` and runs after the global `AuthGuard` and before any pipe.
- `apps/api/src/db/pg-errors.ts`: `isKeyViolation(err)` is `err instanceof pg.DatabaseError && (err.code === '23503' || err.code === '23505')`. A comment says why: RLS hides rows, not keys (`rls-data-access` rule 6).

### 2. Suppliers

- `suppliers.service.ts`: `list(user: AuthUser): Promise<Supplier[]>` returns `withTenant(user.tenantId, trx => trx.selectFrom('suppliers').select(['id','name']).orderBy('name').orderBy('id').execute())`.
- `suppliers.controller.ts`: `@Controller('suppliers')`, `@Get() list(@CurrentUser() user: AuthUser)`. Use `import type` for `AuthUser` and the shared types, as `me.controller.ts` does (decorated signatures with `emitDecoratorMetadata`).
- `suppliers.module.ts`: imports `DatabaseModule`. Register it in `app.module.ts`.
- `suppliers.controller.spec.ts` (criteria 1 and 2): Alice gets exactly Acme's two suppliers in name order, and Bella exactly Globex's, each element parsing with `supplierSchema`; no header gives 401.

### 3. Purchase requests: read model, service, controller

- `purchase-request.query.ts`:
  - `selectPurchaseRequests(trx: TenantTransaction)`:
    - starts from `purchase_requests as pr`;
    - inner-joins `suppliers as s` on `s.id = pr.supplier_id` and `users as r` on `r.id = pr.requester_id`;
    - `leftJoinLateral` a subquery `approvals as a`, inner-joined to `users as ap` on `ap.id = a.approver_id`. The subquery has `whereRef('a.purchase_request_id', '=', 'pr.id')`, `orderBy('a.decided_at', 'desc')`, `orderBy('a.id', 'desc')` and `limit(1)`, and is aliased `d`, with `join.onTrue()`. This gives at most one row per request, even if `approvals` ever held two for one request;
    - selects the columns the mapper needs, with explicit aliases.

    RLS already limits every joined table to the tenant, and the composite foreign keys guarantee each join stays inside it.

  - `toPurchaseRequest(row): PurchaseRequest` (the type from `@levelpath/shared`, so the compiler checks the shape):
    - `amountCents: Number(row.amount_cents)`;
    - `createdAt`/`updatedAt`/`decidedAt` with `.toISOString()`;
    - `supplier: { id, name }`, `requester: { id, name }`;
    - `decision` is `null` when `row.decision` is null, else `{ decision, comment, approver: { id, name }, decidedAt }`.
- `purchase-requests.service.ts` (`@Injectable`, constructor `DatabaseService`). Every method runs in `this.db.withTenant(user.tenantId, async (trx) => …)`. Exceptions thrown inside roll the transaction back.
  - `mine(user)`: `selectPurchaseRequests(trx).where('pr.requester_id', '=', user.userId).orderBy('pr.created_at', 'desc').orderBy('pr.id', 'desc')`, mapped.
  - `toDecide(user)`: `.where('pr.status', '=', 'submitted').orderBy('pr.created_at', 'asc').orderBy('pr.id', 'asc')`, mapped.
  - `create(user, input: CreatePurchaseRequest)`:
    - insert `{ tenant_id: user.tenantId, requester_id: user.userId, supplier_id: input.supplierId, title: input.title, amount_cents: input.amountCents, currency: input.currency }`, `returning('id')`;
    - wrap only the insert in `try/catch`: `if (isKeyViolation(err)) throw new NotFoundException(); throw err;`;
    - then read the row back by id through `selectPurchaseRequests` and return it mapped.
  - `submit(user, id)`:
    - `if (!isUuid(id)) throw new NotFoundException()`, before `withTenant`;
    - inside it, select `id, status` where `id = id` and `requester_id = user.userId`. No row: `NotFoundException`. `status !== 'draft'`: `ConflictException('only a draft can be submitted')`;
    - `updateTable('purchase_requests').set({ status: 'submitted', updated_at: sql\`now()\` }).where('id','=',id).where('status','=','draft').returning('id').executeTakeFirst()`. Nothing returned: `ConflictException`;
    - return the read-back.
  - `decide(user, id, input: Decision)`:
    - `if (user.role !== 'approver') throw new ForbiddenException()`. The guard already did this; it is repeated so the rule holds even if the service is called elsewhere, as the intent asks;
    - then `isUuid` → 404;
    - inside `withTenant`, select `id, status, requester_id` where `id = id` and `(requester_id = user.userId OR status <> 'draft')` (`eb.or`). No row: 404. `requester_id === user.userId`: `ForbiddenException()`. `status !== 'submitted'`: `ConflictException('only a submitted request can be decided')`;
    - conditional update `set({ status: input.decision, updated_at: sql\`now()\` }).where('id','=',id).where('status','=','submitted').returning('id')`. Nothing returned: 409;
    - insert into `approvals` `{ tenant_id: user.tenantId, purchase_request_id: id, approver_id: user.userId, decision: input.decision, comment: input.comment === '' ? null : input.comment }`;
    - return the read-back.
  - No other `catch`. No logging of titles, comments or names.
- `purchase-requests.controller.ts`, `@Controller('purchase-requests')`:
  - `@Get('mine') mine(@CurrentUser() user)`;
  - `@Get('to-decide') @UseGuards(ApproverGuard) toDecide(@CurrentUser() user)`;
  - `@Post() create(@CurrentUser() user, @Body(new ZodValidationPipe(createPurchaseRequestSchema)) body: CreatePurchaseRequest)` (default 201);
  - `@Post(':id/submit') @HttpCode(200) submit(@CurrentUser() user, @Param('id') id: string)`;
  - `@Post(':id/decision') @HttpCode(200) @UseGuards(ApproverGuard) decide(@CurrentUser() user, @Param('id') id: string, @Body(new ZodValidationPipe(decisionSchema)) body: Decision)`.

  Use `import type` for `AuthUser`, `CreatePurchaseRequest` and `Decision`. No `ParseUUIDPipe`: it answers 400, and the contract wants 404.

- `purchase-requests.module.ts`: imports `DatabaseModule`, controller and service. Register it in `app.module.ts`.

### 4. Purchase-request tests (with step 3; real database, no mocks)

- **Test helpers** in `apps/api/test/helpers.ts`:
  - `deleteRowsTestsCreated(owner: pg.Client)`: deletes `approvals` whose `id` is not among `SEED.*.approvals`, then `purchase_requests` whose `id` is not among `SEED.*.purchaseRequests` (`not (id = any($1::uuid[]))`);
  - `seededRequestsSnapshot(owner)`: returns `id, status, updated_at` of the eight seeded requests and the count of `approvals`, ordered by id.
- Every new spec file:
  - `beforeAll`: `startApp()`, `ownerClient()`, take a snapshot;
  - `afterAll`: `deleteRowsTestsCreated(owner)`, close the app and the client;
  - last `it`: "left the seeded requests unchanged" (the snapshot of seeded rows is equal; criterion 18).
- Small local helpers per file:
  - `call(userId, method, path, body?)`: `fetch` with `X-User-Id` and JSON;
  - `createAs(user)` and `submitAs(user, id)`, to build fresh rows. Never use a seeded row for a happy path.
- Parse every success body with `purchaseRequestSchema`/`supplierSchema` and every error body with `apiErrorSchema`.
- `lists.spec.ts`: criteria 6 and 7, and 401 for both GETs.
  - Amir's `mine` holds only his own requests (checked first: `[]`);
  - for `mine`, create P1 then P2 as Alice and expect P2 at index 0 and P1 at index 1;
  - `createdAt` is non-increasing (`mine`) or non-decreasing (`to-decide`);
  - Globex ids are absent from Acme lists and the other way round;
  - the seeded `a…0303` decision is exactly as in criterion 6;
  - Alice on `to-decide` gets 403;
  - Amir's own submitted request appears in his `to-decide`.
- `create.spec.ts`: criteria 3, 4 and 5, and 401.
  - The happy path at `amountCents: 10_000_000_000`, where `typeof amountCents === 'number'`, and the owner row has `tenant_id` Acme and `requester_id` Alice;
  - each invalid body in criterion 4 gives 400 with `issues`, and the owner's count of `purchase_requests` is unchanged;
  - Globex's supplier and an unknown supplier give 404 with the same body, and no row is inserted.
- `submit.spec.ts`: criteria 8, 9 and 10, and 401.
  - After a submit, the owner query `select updated_at > created_at as later` (compared in SQL, at microsecond precision, not as JS `Date`s) is `true`;
  - the four 404 cases give identical bodies, and the owner row is unchanged for the Globex draft and for Amir's draft;
  - Amir submitting Alice's seeded draft gives 404;
  - 409 for the seeded submitted and approved requests, and for a second submit.
- `decision.spec.ts`: criteria 11 to 17, and 401.
  - Approve with `comment: null`, and reject with a trimmed comment. The owner sees exactly one approval each, with `approver_id` Amir and `tenant_id` Acme;
  - every 400 body in criterion 12, after which the request stays `submitted` with no approval;
  - every requester case in criterion 13 gives 403, including the invalid body and the non-UUID id;
  - every 404 case in criterion 14 gives identical bodies, and Globex's `…0302` stays `submitted` with no new approval;
  - self-approval gives 403, with no approval and the status unchanged;
  - 409 for the seeded approved and rejected requests, and for a second decision;
  - **concurrency**: `Promise.all` of two approve calls on one fresh submitted request, then `[200, 409]` in any order and exactly one `approvals` row.

### 5. Validate

`pnpm db:up`, then the validation commands below. Then run the API on your port and walk the curl criteria in the spec.

### 6. Docs

- `docs/LEARNING.md`, two entries after "Contract first, then build in parallel (Phase 3)", in the existing What / Why it matters / Where format:
  - **"Guards run before pipes: a role check that reveals nothing (Phase 3)"**: Nest's order is middleware, guards (global, then controller, then route), interceptors, pipes, handler. `ApproverGuard` therefore answers 403 before the body is parsed or any id is looked up. Where: `approver.guard.ts`, `zod-validation.pipe.ts`, `decision.spec.ts`.
  - **"Status changes as a conditional UPDATE (Phase 3)"**: a read-then-write race, and why `UPDATE … WHERE status = 'submitted'` plus "no row means 409" is enough under READ COMMITTED (the second writer waits for the row lock, then re-checks the `WHERE`). Where: `purchase-requests.service.ts` and the concurrency test.
- `.claude/skills/nestjs-endpoint/SKILL.md`: as in Files.
- `CLAUDE.md`: as in Files, one line, no other changes.

## Tests

- **Unit:** `zod-validation.pipe.spec.ts` (the path mapping including root `''`, the parsed output, the error body parses with `apiErrorSchema`).
- **HTTP against the run's real database:** `suppliers.controller.spec.ts`, `lists.spec.ts`, `create.spec.ts`, `submit.spec.ts`, `decision.spec.ts`. Edge cases: `amountCents` at the cap (beyond 32-bit), a trimmed title and comment, an unknown key in each body, no body, a non-UUID id, ties in `created_at` on seeded rows (the `id` tie-breaker keeps the order stable), and concurrent decisions.
- **Tenant isolation through the routes:** tenant A (Alice, Amir) cannot select tenant B's rows (absent from `mine`/`to-decide`/`suppliers`), cannot update them (submit and decision on Globex's ids give 404, and the owner sees the row unchanged with no approval), and cannot reference them (create with Globex's supplier gives 404 and no row). There are no delete routes. Table-level select, update, delete and insert across tenants is already covered by `apps/api/src/db/rls-isolation.spec.ts`, which this change leaves alone.
- Existing tests are not edited. `migrations.spec.ts`'s seed counts keep passing because every new file deletes what it created.

## Validation commands

```bash
cd <worktree> && pnpm db:up
cd <worktree> && pnpm install
cd <worktree> && pnpm build
cd <worktree> && pnpm lint
cd <worktree> && pnpm test
cd <worktree> && git diff --stat origin/main -- db/ apps/web packages/shared   # empty
```

Behaviour, on your own ports (dev database migrated and seeded):

```bash
pnpm --filter @levelpath/shared build
API_PORT=<a> pnpm --filter @levelpath/api dev
API=http://localhost:<a>; ALICE=a0000000-0000-4000-8000-000000000101; AMIR=a0000000-0000-4000-8000-000000000102
curl -s -H "X-User-Id: $ALICE" $API/suppliers
ID=$(curl -s -X POST -H "X-User-Id: $ALICE" -H 'Content-Type: application/json' \
  -d '{"title":"Chairs","amountCents":10000000000,"supplierId":"a0000000-0000-4000-8000-000000000201"}' \
  $API/purchase-requests | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
curl -s -X POST -H "X-User-Id: $ALICE" $API/purchase-requests/$ID/submit
curl -s -X POST -H "X-User-Id: $AMIR" -H 'Content-Type: application/json' -d '{"decision":"rejected","comment":"Over budget"}' $API/purchase-requests/$ID/decision
curl -s -i -X POST -H "X-User-Id: $ALICE" -H 'Content-Type: application/json' -d '{"decision":"approved"}' $API/purchase-requests/$ID/decision   # 403
curl -s -i -X POST -H "X-User-Id: $AMIR" -H 'Content-Type: application/json' -d '{"decision":"approved"}' $API/purchase-requests/b0000000-0000-4000-8000-000000000302/decision   # 404
factory/bin/port stop <a>
```

## Notes

- **Never touch a seeded row in a happy path**: other spec files and `migrations.spec.ts` rely on the seed exactly. Spec files run one after another on one shared database, in no guaranteed order.
- **The two 403s have the same body** (`new ForbiddenException()` with no message), as do all 404s (`new NotFoundException()` with no message). Don't add messages that differ by cause to 404s: identical bodies are what criteria 9 and 14 check. 409s may carry a message.
- `ConflictException('…')` bodies include `"error":"Conflict"`. `apiErrorSchema` is not strict, so that is fine.
- `withTenant` throws a plain `Error` for a non-UUID tenant. The tenant always comes from the guard, so this can't happen from a route.
- Kysely returns `numUpdatedRows` as a `bigint`. Use `.returning('id').executeTakeFirst()` for the conditional updates, so the check is just "a row came back".
- Don't add `@Public()` anywhere, don't read `req.body`, `req.query` or headers for a tenant, and don't add `sql.raw`/`sql.ref`/`sql.table` on input.
- If `pnpm install` would change anything beyond the `apps/api` importer's `zod` entry in `pnpm-lock.yaml`, stop and check.
- The web job (003) builds against the same contract in parallel and touches only `apps/web`. Don't touch `apps/web` or `packages/shared`.
