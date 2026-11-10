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
