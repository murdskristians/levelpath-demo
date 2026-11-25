# Learning log

One entry per new concept: what it is, why it matters, where it lives in this repo.

## pnpm workspaces (Phase 0)

- **What:** One repo, several packages. `pnpm-workspace.yaml` lists the folders (`apps/*`, `packages/*`). `pnpm install` once at the root installs everything and links the packages together. `pnpm -r <script>` runs a script in every package, dependencies first.
- **Why it matters:** `api`, `web` and `shared` can share code and be built and tested with one command, with a single lockfile.
- **Where:** [pnpm-workspace.yaml](../pnpm-workspace.yaml), root [package.json](../package.json) scripts.

## Shared tsconfig base (Phase 0)

- **What:** `tsconfig.base.json` holds the strict compiler options. Each package `extends` it and adds only what differs (Nest needs decorators and `NodeNext` ES modules; Vite needs JSX and `noEmit`).
- **Why it matters:** One definition of "strict", no drift between packages.
- **Where:** [tsconfig.base.json](../tsconfig.base.json), `apps/*/tsconfig.json`.

## NestJS module, controller, dependency injection (Phase 0)

- **What:** A **controller** maps HTTP routes to methods (`@Controller('health')` + `@Get()`). A **module** (`@Module`) is a box that lists the controllers and providers that belong together. **Dependency injection (DI):** a class asks for what it needs in its constructor, and Nest builds and passes it in. `HealthController` asks for a `HealthService` in its constructor, and the test builds a tiny module with `Test.createTestingModule` and asks it for the controller, the same way the app does.
- **Why it matters:** Services, guards and the database transaction context in Phase 2 all hang off this mechanism. Nest finds the constructor types through emitted _decorator metadata_ (`design:paramtypes`). Tools that strip types without emitting it (plain esbuild) break DI silently: the dependency arrives as `undefined`.
- **Where:** `apps/api/src/app.module.ts`, `health.service.ts`, `health.controller.ts`, `health.controller.spec.ts`.

## NestJS 12 is ESM-only, tested with Vitest (Phase 0)

- **What:** `@nestjs/*` 12 ships as ES modules (`"type": "module"`), and Nest 12 makes Vitest the default runner for ESM projects. So the API is an ES module: `module`/`moduleResolution` are `NodeNext`, and relative imports end in `.js` (`./health.service.js`) even though the source is `.ts`. Nest 11 (npm tag `legacy`) is the CommonJS line.
- **Why it matters:** Jest could not load `@nestjs/testing` 12 (it is ESM), which is why the approved Jest plan changed to Vitest for the API. Decision made with Chris in Phase 0.
- **Verified:** A probe test printed `Reflect.getMetadata('design:paramtypes', HealthController)` and got `HealthService`, with and without the explicit tsconfig and Vitest flags. Vite 8's Oxc transform emits the metadata on its own, so the API Vitest config needs no SWC plugin. The `emitDecoratorMetadata` flag stays in `tsconfig.json` for `nest build` (tsc).
- **Where:** `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`.

## Docker Compose healthcheck (Phase 0)

- **What:** `healthcheck` runs `pg_isready` inside the container until it succeeds. `docker compose up --wait` blocks until the service reports healthy.
- **Why it matters:** `pnpm dev` only starts the apps once Postgres actually accepts connections, instead of racing it.
- **Where:** [docker-compose.yml](../docker-compose.yml), `db:up` script in root `package.json`.

## Hooks: PreToolUse and PostToolUse (Phase 1)

- **What:** Claude Code runs a command before (PreToolUse) or after (PostToolUse) each tool call. It sends the call as JSON on stdin. Exit code 2 on PreToolUse **blocks** the call, and stderr goes back to the agent as the reason. Exit 2 on PostToolUse doesn't undo anything, but shows stderr to the agent as feedback.
- **Why it matters:** A hook is enforced by the harness, not by the model, so it holds even when a prompt is ignored, and even under `--dangerously-skip-permissions` (tested in the spike). git-adw's guard was wired `|| true`, which turned every exit 2 into 0: it never blocked anything.
- **Where:** [.claude/settings.json](../.claude/settings.json), [.claude/hooks/guard.py](../.claude/hooks/guard.py), [.claude/hooks/format_on_edit.py](../.claude/hooks/format_on_edit.py).

## Subagents, and the same agent run headless (Phase 1)

- **What:** A subagent is a markdown file in `.claude/agents/`. Its frontmatter sets the name, tools and model; its body is the system prompt. A session spawns it with the Agent tool and gets back one reply. `claude -p --agent <name>` runs the same file as a whole headless session.
- **Why it matters:** One definition per role, three drivers: `/factory run` spawns roles as subagents, the ADWs run them with `--agent`, the L1 commands spawn them. A frontmatter Stop hook fires for a subagent but **not** for an `--agent` session (spike), so the ADWs run the gate themselves.
- **Where:** [.claude/agents/](../.claude/agents/), [adws/adw_modules/agent.py](../adws/adw_modules/agent.py).

## Skills (Phase 1)

- **What:** A folder in `.claude/skills/<name>/` with a `SKILL.md`. Only its `description` is always in context; Claude loads the body when a task matches the description.
- **Why it matters:** Domain rules (NestJS endpoints, RLS, LLM calls) reach the agent when they are needed, instead of a huge `CLAUDE.md` every session pays for. The description is the trigger, so it says _when_ to use the skill.
- **Where:** [.claude/skills/](../.claude/skills/).

## Git worktrees (Phase 1)

- **What:** `git worktree add <path> -b <branch> origin/main` gives a second checkout of the same repo, on its own branch, sharing one `.git`.
- **Why it matters:** Parallel jobs each get their own files, branch, dev-server ports and (from Phase 2) database, so two agents never edit the same checkout. The main checkout stays yours.
- **Where:** `.worktrees/<job>` (factory), `trees/<adw_id>` (ADWs), `.worktrees/try-<pr>` (`/try`).

## A state machine with one writer (Phase 1)

- **What:** `factory/bin/job` is the only program that changes a job's `job.json`. Each move (`advance <job> <stage>`) is checked against a table of legal transitions and the files that justify it (no `gate` without `STATUS: READY`, no `review` without `GATE: PASS`).
- **Why it matters:** The orchestrating agent can't skip a step or invent a state. When the session dies, the files say exactly where to resume.
- **Where:** [factory/bin/job](../factory/bin/job) (`TRANSITIONS`).

## The gate: a deterministic judge (Phase 1)

- **What:** `factory/checks.sh` runs install, build, lint and test, run by `factory/bin/gate` from the main checkout inside the job's worktree. It is pass/fail by exit code, and it also fails a branch that changed a protected harness file.
- **Why it matters:** "It works" is decided by a script, not an LLM opinion. No reviewer runs on a failing build, and a branch can't edit the checks it is judged by.
- **Where:** [factory/checks.sh](../factory/checks.sh), [factory/bin/gate](../factory/bin/gate).

## Routing by risk (Phase 1)

- **What:** Intake rates each job's risk (`low`, `medium`, `high`) and surfaces (`api`, `ui`, `db`, `llm`, `security`). A table maps them to the reviewers that run and the model each uses.
- **Why it matters:** Cost goes where the risk is: a low-risk change gets sonnet and haiku reviewers, a high-risk one gets an opus planner, builder and security reviewer.
- **Where:** [factory/config.json](../factory/config.json) `routing`, `surface_reviewers`, `builder_models`.

## File contracts instead of parsing prose (Phase 1)

- **What:** Every role writes one known file whose first line is the answer: `DECISION:`, `STATUS:`, `GATE:`, `VERDICT:`, `READY | ESCALATE`. Drivers read that line; they never parse the agent's chat.
- **Why it matters:** git-adw parsed paths and JSON out of replies, and "Plan file does not exist" was a sentence printed before the path. A file contract can't be broken by a chatty agent.
- **Where:** [docs/HARNESS.md](HARNESS.md) ("A run, step by step").

## Prompt injection and untrusted input (Phase 1)

- **What:** Text a stranger can write (a public issue, a purchase description) can contain instructions aimed at the agent.
- **Why it matters:** Issue text reaches agents only as quoted data in `issue.md`, with a note that it is data, not instructions. The ADW trigger acts only on the owner's comments. Phase 4's LLM call validates the output against a schema, so injected text can't produce anything but a fallback.
- **Where:** `issue.md` in every job folder, [adws/adw_triggers/trigger_cron.py](../adws/adw_triggers/trigger_cron.py), the `llm-call` skill.

## Resolving package files in ESM (Phase 1)

- **What:** ESM has no `__dirname`. Use `new URL('../package.json', import.meta.url)` to find a file relative to the current module.
- **Why it matters:** `/version` reads `apps/api/package.json` at runtime. The same path works from `src/` and from the built `dist/`, because both sit directly under `apps/api`.
- **Where:** [version.service.ts](../apps/api/src/version.service.ts).

## Kysely: a typed SQL builder (Phase 2)

- **What:** Kysely is a library that lets you write SQL as TypeScript calls (`db.selectFrom('suppliers').where('name', '=', x).selectAll()`), and checks the table and column names against types you give it. It is not an ORM: no entities, no hidden queries, no generated migrations. What you write is the SQL that runs.
- **Why it matters:** RLS is only as safe as the connection it runs on. With Kysely, every database call in a request goes through one explicit transaction (`db.transaction().execute(trx => …)`), and the first line of it sets the tenant (`SET LOCAL app.tenant_id`). Nothing can quietly use another connection, which is the point of the design. The policies and migrations stay plain `.sql` files we can read aloud in the interview.
- **Where:** [database.service.ts](../apps/api/src/db/database.service.ts) (the only file that holds it) and the table types in [schema.ts](../apps/api/src/db/schema.ts). Chosen over Drizzle, TypeORM and Prisma; see the intent's decision.

## Row-level security, enabled and forced (Phase 2)

- **What:** A policy on a table is a condition Postgres adds to every query on it, like an invisible `WHERE`. `USING` filters the rows you can read, update or delete; `WITH CHECK` refuses a row you write unless it passes. Ours: `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`. `ENABLE` turns the policies on, and `FORCE` applies them to the table's owner too.
- **Why it matters:** Isolation then doesn't depend on every query remembering a `WHERE tenant_id = …`: a forgotten filter returns nothing, not someone else's data. With no tenant set, the setting is NULL (or `''`, which `NULLIF` turns into NULL), and NULL matches no row, so it fails closed.
- **Where:** every file in [db/migrations/](../db/migrations/); the tests in [rls-isolation.spec.ts](../apps/api/src/db/rls-isolation.spec.ts).

## The app logs in as a role that owns nothing (Phase 2)

- **What:** Migrations run as the owner (`levelpath_owner`, the image's superuser). The API logs in as `levelpath_app`: no superuser, no `BYPASSRLS`, owns no table, and holds only the grants it needs (read-only on `tenants` and `users`).
- **Why it matters:** A superuser and a `BYPASSRLS` role skip RLS entirely, even with `FORCE`. If the API connected as the owner, every policy would be decoration, and nothing would look wrong. So it is checked, not trusted. The API refuses to start on a login that is a superuser, has `BYPASSRLS` or `REPLICATION`, is a member of another role (it could `SET ROLE` to the owner), owns tables or schemas, may create schemas, objects in a schema or temporary tables, or may `TRUNCATE` a table (RLS doesn't cover `TRUNCATE`). `pnpm db:migrate` refuses an existing `APP_DB_USER` with any attribute or membership the role it creates doesn't have. A test asserts the role's rights from the catalog. The role also can't create temporary tables: one named like a real table would shadow it on that pooled connection, because Postgres searches temporary tables first.
- **Where:** `ensureAppRole()` in [db-lib.mjs](../apps/api/db-tools/db-lib.mjs); the startup check `onModuleInit` in [database.service.ts](../apps/api/src/db/database.service.ts); [db-config.ts](../apps/api/src/db/db-config.ts) never reads the owner's login; [migrations.spec.ts](../apps/api/src/db/migrations.spec.ts).

## SET LOCAL and the connection-pool leak (Phase 2)

- **What:** A pool keeps a few connections open and lends them to requests in turn. A plain `SET app.tenant_id` lasts for the connection's whole session, so the next request on that connection would run as the previous tenant. `set_config('app.tenant_id', $1, true)` is the `LOCAL` form: it ends with the transaction, on commit or rollback.
- **Why it matters:** This is the classic way RLS setups leak. `withTenant` opens a transaction, sets the tenant first, and runs the request's queries inside it. The connection always goes back to the pool with no tenant. A test with a pool of one connection proves it, and it fails if the `true` becomes `false`: we flipped it on purpose and saw _"expected 2 to be 0"_, the next query seeing Acme's two suppliers.
- **Where:** `withTenant` in [database.service.ts](../apps/api/src/db/database.service.ts); [with-tenant.spec.ts](../apps/api/src/db/with-tenant.spec.ts).

## Composite foreign keys: RLS doesn't check references (Phase 2)

- **What:** Foreign-key checks run without RLS. A plain `supplier_id REFERENCES suppliers (id)` would accept another tenant's supplier. So the keys are composite: `(tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id)`, against a `UNIQUE (tenant_id, id)` on the parent, and the referenced row must have the same tenant.
- **Why it matters:** Without it, a crafted id links tenant A's request to tenant B's data. A NULL in a composite key skips the check (`MATCH SIMPLE`), which is safe: a NULL points at nothing, and `tenant_id` is `NOT NULL` everywhere.
- **Where:** [0003_purchase_requests.sql](../db/migrations/0003_purchase_requests.sql), [0004_approvals.sql](../db/migrations/0004_approvals.sql); "cross-tenant references" in [migrations.spec.ts](../apps/api/src/db/migrations.spec.ts).

## A SECURITY DEFINER lookup, and its search_path (Phase 2)

- **What:** A `SECURITY DEFINER` function runs with its owner's rights, not the caller's. `app_resolve_user(id)` returns one user's id, tenant and role, and it is the only function of ours the app role may call. `SET search_path = pg_catalog, pg_temp` and schema-qualified names stop a caller from slipping in its own `users` table.
- **Why it matters:** The login has to find a user's tenant before any tenant is set, and RLS hides every user until then. Turning RLS off on `users`, or adding a policy that a second setting opens, would widen what the app can read. A one-id-in, one-row-out function is the narrowest exception, and tests pin it down: no name, nothing for an unknown id, not callable by `PUBLIC`. `resolveUser` calls it with `${userId}::uuid`: an untyped argument would also match a look-alike `app_resolve_user(text)`, and Postgres would pick that one (a test plants one and fails without the cast).
- **Where:** [0001_tenants_and_users.sql](../db/migrations/0001_tenants_and_users.sql); `resolveUser` in [database.service.ts](../apps/api/src/db/database.service.ts); [user-lookup.spec.ts](../apps/api/src/db/user-lookup.spec.ts).

## NestJS guards, and the X-User-Id stub (Phase 2)

- **What:** A guard is a class Nest runs before a route handler; it lets the request through or throws. `AuthGuard` is registered as `APP_GUARD`, so it runs for every route: it reads `X-User-Id`, resolves it to the user's id, tenant and role, and puts that on the request for `@CurrentUser()`. Routes marked `@Public()` (`/health`, `/version`) skip it.
- **Why it matters:** Protected by default: a new route is closed until someone opens it. A missing, malformed or unknown id gets the same 401, so responses don't reveal which users exist. **It is not authentication:** anyone can send any id. It stands in for a real login (a signed token) so that the demo can show the tenant flowing from the request into `withTenant`, never from the body or query.
- **Where:** [apps/api/src/auth/](../apps/api/src/auth/); [auth.guard.spec.ts](../apps/api/src/auth/auth.guard.spec.ts) and [me.controller.spec.ts](../apps/api/src/me/me.controller.spec.ts) over real HTTP.

## A database per test run (Phase 2)

- **What:** Vitest's global setup creates `lp_<random>` on the shared Postgres server, migrates and seeds it as the owner, hands its name to the tests (`provide` / `inject`), and drops it when the run ends. The tests then connect as the app role.
- **Why it matters:** Factory and ADW runs build in parallel worktrees. With one shared database their test rows would collide; with one database each they never meet, and nothing is left behind. One server for all: a Postgres container per worktree would fight over port 5432.
- **Where:** [global-setup.mjs](../apps/api/test/global-setup.mjs), [helpers.ts](../apps/api/test/helpers.ts), [vitest.config.ts](../apps/api/vitest.config.ts).

## Contract first, then build in parallel (Phase 3)

- **What:** Before the API and the UI are built, their agreement is written down and merged: the routes, who may call them, the errors, and the request and response shapes as Zod schemas in `packages/shared`. The API validates every body with those schemas; the web app validates its forms and reads responses with the same ones.
- **Why it matters:** Two jobs can then run at the same time in separate worktrees, an API job and a UI job, without waiting for each other or guessing. A shape that changes breaks the build of both, not a demo. It is also the review point that matters most: the error rules (404 for what you may not see, 403 only when it reveals nothing) were decided once, by a person.
- **Where:** [purchase-requests-contract.md](specs/purchase-requests-contract.md), [packages/shared/src/](../packages/shared/src/).

## Guards run before pipes: a role check that reveals nothing (Phase 3)

- **What:** Nest handles a request in a fixed order: middleware, then guards (global, then controller, then route), then interceptors, then pipes, then the handler. `ApproverGuard` is a route guard (`@UseGuards`), so it runs after the global `AuthGuard` has resolved the caller's role, and before `ZodValidationPipe` parses the body or the service looks up the id.
- **Why it matters:** A requester calling `POST /purchase-requests/:id/decision` gets the same 403 for every input: a valid body or not, a real id, another company's id or not a UUID at all. Had the role been checked in the handler, the 400 for a bad body and the 404 for an unknown id would come first and tell a requester something about the request they named. Ordering the checks is part of what a response may reveal.
- **Where:** [approver.guard.ts](../apps/api/src/auth/approver.guard.ts), [zod-validation.pipe.ts](../apps/api/src/validation/zod-validation.pipe.ts), [decision.spec.ts](../apps/api/src/purchase-requests/decision.spec.ts).

## Status changes as a conditional UPDATE (Phase 3)

- **What:** Submit and decide first read the request to pick the right answer (404, 403, 409), then change the status with `UPDATE … WHERE id = $1 AND status = 'submitted' RETURNING id`. No row back means someone else changed it first: 409, and nothing is written.
- **Why it matters:** Read, then write, is a race: two approvers can both read `submitted` and both decide, leaving two approvals. Under Postgres' default READ COMMITTED, the second `UPDATE` waits for the first transaction's row lock, then re-checks its `WHERE` against the committed row, finds `approved`, and updates nothing. That closes the race without a lock of our own, a unique key or a migration.
- **Where:** [purchase-requests.service.ts](../apps/api/src/purchase-requests/purchase-requests.service.ts); the concurrency test in [decision.spec.ts](../apps/api/src/purchase-requests/decision.spec.ts).

## Building the UI against a contract with a mocked fetch (Phase 3)

- **What:** The web screens are written and tested before the API routes exist. The only fake is `fetch`: a helper answers by `METHOD /path` with fixtures that are parsed by the shared Zod schemas, and records every call. The app parses every response with the same schemas, so a drifting shape fails loudly on both sides.
- **Why it matters:** The UI job and the API job run in parallel from the contract. Because fixtures must satisfy the real schemas, the mock cannot quietly drift from the contract. The database and RLS are never mocked; only the network edge is.
- **Where:** [api.ts](../apps/web/src/api.ts), [fixtures.ts](../apps/web/src/test/fixtures.ts), [App.test.tsx](../apps/web/src/App.test.tsx).

## A dev proxy, and what "Bad Gateway" means (Phase 3)

- **What:** In development the browser talks only to Vite (port 5173). Vite forwards every `/api/...` request to the API on `API_PORT` (3000), so the page and the API look like one origin and need no CORS setup. A **gateway** is anything that forwards requests to a server behind it; **502 Bad Gateway** means the gateway is up but the server behind it didn't answer.
- **Why it matters:** "Bad Gateway" in the app is never an API bug: it means the API isn't running (or not yet). Look at the API's own output first. Vite starts in ~1 s and the API in ~10 s, so the web's `dev` script now waits for the API's `/health` before starting Vite.
- **Where:** `apiProxy` in [vite.config.ts](../apps/web/vite.config.ts), [wait-for-api.mjs](../apps/web/scripts/wait-for-api.mjs).

## After a pull: install, then run (Phase 3)

- **What:** `git pull` updates `package.json` and `pnpm-lock.yaml`, but not `node_modules`. If a merged PR added a package, the code needs a module that isn't installed until `pnpm install` runs. `pnpm install` with nothing new to install takes about 3 s.
- **Why it matters:** After PR #8 added `zod` to the API, the API stopped compiling ("Cannot find module 'zod'"), while the web app, with nothing new, kept running. That looked like a web problem. `pnpm dev` now runs `pnpm install` first.
- **Where:** the `dev` script in the root [package.json](../package.json).

## One deadline for every attempt (Phase 4)

- **What:** A suggestion gets one 15 s budget (`SUGGESTION_DEADLINE_MS`), set when the request arrives. Each provider call gets what is left of it, both as the SDK's `timeout` and as an `AbortSignal`, and the service races the call against the deadline, so a provider that ignores the signal still can't hold the request. The SDK's own retries are off (`maxRetries: 0`).
- **Why it matters:** Retries hidden inside retries multiply: three SDK retries times two attempts, each with its own 60 s timeout, is minutes of a spinner and several bills for one click. One deadline owned by one place bounds both the wait and the cost, and the user can always click again.
- **Where:** `raceAbort` and `suggest` in [suggestions.service.ts](../apps/api/src/suggestions/suggestions.service.ts); the client options in [anthropic.provider.ts](../apps/api/src/suggestions/anthropic.provider.ts).

## Validate what the model returns, with your own schema (Phase 4)

- **What:** The model is asked for JSON in the shape of `suggestionSchema` (structured outputs), but its answer is still treated as untrusted input: `suggestionSchema.safeParse` decides, every time. The structured-output decoder only enforces the JSON shape; limits such as `maxLength`, `minimum` or the currency pattern are moved into field descriptions, so `"eur"` or a quantity of `0` can still come back.
- **Why it matters:** "The model will follow the format" is a hope, not a check. One schema in `packages/shared` is what the model is sent, what the API accepts and what the web app parses, so all three agree, and a bad answer is caught at the edge instead of in the form.
- **Where:** [purchase-requests.ts](../packages/shared/src/purchase-requests.ts) (`suggestionSchema`), [suggestions.service.ts](../apps/api/src/suggestions/suggestions.service.ts).

## A repair loop with a cap (Phase 4)

- **What:** When the answer fails the schema, the service asks once more, with the validation errors in a `<validation_errors>` block (paths and messages only). At most 2 calls in total. Only schema failures are repaired: a refusal, `max_tokens`, a timeout or an API error falls back at once.
- **Why it matters:** Showing the model exactly what was wrong fixes most near-misses cheaply, and the cap keeps a stubborn failure from becoming a loop. Repairing a refusal or a cut-off answer would only repeat the same failure at double the cost.
- **Where:** [suggestions.service.ts](../apps/api/src/suggestions/suggestions.service.ts), [prompt.ts](../apps/api/src/suggestions/prompt.ts); the `mock:repair` marker in [mock.provider.ts](../apps/api/src/suggestions/mock.provider.ts).

## A fallback the user can't tell from "no idea" (Phase 4)

- **What:** Whatever goes wrong with the LLM, the route answers `200 {"suggestion": null}` and the form says "No suggestion this time. Fill in the fields yourself." in a `role="status"` note, never in the page's error alert. The reason (`invalid`, `timeout`, `refusal`, `max_tokens`, `error`) goes to the log, not to the client.
- **Why it matters:** Suggest fields is a convenience on top of a form that works without it. A 500 or a red alert would turn an optional helper into a broken page. Degrading to the plain form keeps the core path working when the model is slow, down or wrong, and the log still tells the developer why.
- **Where:** [suggestions.service.ts](../apps/api/src/suggestions/suggestions.service.ts), [NewRequestForm.tsx](../apps/web/src/components/NewRequestForm.tsx).

## Prompt injection: the description is data, not instructions (Phase 4)

- **What:** The user's text goes only into the user message, inside `<description>` tags, with `&`, `<` and `>` escaped, so `</description>` in the text can't close the block. The system prompt says the block is data. The supplier list comes from the database (the caller's tenant), never from the request, and a `supplierId` outside it becomes `null`.
- **Why it matters:** Anyone can type "ignore your instructions" into a form. Escaping keeps the text from changing the prompt's structure, and the checks after the call (schema, supplier filter) limit what an injection that still works can do: at worst a wrong suggestion the user sees and edits, never another company's supplier.
- **Where:** [prompt.ts](../apps/api/src/suggestions/prompt.ts), `withOwnSupplier` in [suggestions.service.ts](../apps/api/src/suggestions/suggestions.service.ts); the injection cases in [evals/cases.json](../evals/cases.json).

## Theming with custom properties and a pre-paint script

- **What:** Every color in `App.css` is a CSS custom property declared on `:root` (light) and overridden under `:root[data-theme='dark']`. The theme (stored choice, else the OS `prefers-color-scheme`, else light) is set as `data-theme` on `<html>` by a small inline script in `index.html`, and again by React when the toggle is pressed.
- **Why it matters:** A client-rendered app paints before React runs, so setting the theme only in React flashes the wrong one. The inline script runs while the page is still being parsed. The toggle state lives in `App`, above the keyed `Dashboard`, so switching users does not reset it. Nothing is stored until the button is pressed, so the OS keeps deciding until the user chooses.
- **Where:** [App.css](../apps/web/src/App.css), [index.html](../apps/web/index.html), [theme.ts](../apps/web/src/theme.ts), [ThemeToggle.tsx](../apps/web/src/components/ThemeToggle.tsx).

## Logs without personal data (Phase 4)

- **What:** Each suggestion writes one JSON line: provider, model, latency, attempts, validation failures, outcome, reason, error class, and the description's length and the first 12 hex characters of its SHA-256. Never the description, the model's output, `err.message`, a key or a name.
- **Why it matters:** A purchase description can hold names, prices or anything a user pastes. The hash still lets you see that the same text failed three times, and the length and latency explain most problems, without the log becoming a second copy of user data.
- **Where:** the `llm_suggestion` line at the end of `suggest` in [suggestions.service.ts](../apps/api/src/suggestions/suggestions.service.ts); the log tests in [suggestions.service.spec.ts](../apps/api/src/suggestions/suggestions.service.spec.ts).
