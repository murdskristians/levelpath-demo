# Plan: Add GET /version endpoint

> Spec: agents/ec19ba08/spec.md · Type: feature

## Approach

Copy the health pattern: a `VersionService` reads `package.json` and a `VersionController` returns it. The path is `new URL('../package.json', import.meta.url)`. It works from `src/` and from `dist/`, because both sit directly under `apps/api` (`rootDir: src`, no nested folders). This avoids hardcoding the version, and avoids a JSON import, which `rootDir: src` would reject.

## Libraries and versions

None. It uses only `node:fs` and the NestJS packages already installed (`@nestjs/*` ^12, ESM-only). No `pnpm view` check is needed because nothing is added.

## Files

- `apps/api/src/app.module.ts` — add the controller and provider.

### New files

- `apps/api/src/version.service.ts` — `@Injectable()` with `version(): string`. It reads and parses `../package.json` with `readFileSync(new URL(...))`. It wraps this in try/catch that logs via Nest `Logger` and rethrows. It caches the result.
- `apps/api/src/version.controller.ts` — `@Controller('version')`, `@Get() get(): { version: string }`.
- `apps/api/src/version.controller.spec.ts` — the test.

## Steps

### 1. Service, controller, wiring, test

- Create the service and controller. Relative imports end in `.js`.
- Register both in `AppModule`.
- Write the spec like `health.controller.spec.ts`. Use `Test.createTestingModule` with `VersionController` and `VersionService`. Read `package.json` independently in the test, and expect `controller.get()` toEqual `{ version }`. Also assert it's a non-empty string.

### 2. Validate

Run the validation commands below.

## Tests

- `version.controller.spec.ts`: response shape and value matches `package.json`. No DB and no mocks.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
API_PORT=3111 node apps/api/dist/main.js &   # after build
curl -i localhost:3111/version               # 200, {"version":"0.0.0"}
factory/bin/port stop 3111
```

## Notes

Add a short line to `docs/LEARNING.md` about resolving package files in ESM via `import.meta.url`, since `__dirname` doesn't exist there.
