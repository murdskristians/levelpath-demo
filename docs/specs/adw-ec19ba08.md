# Add GET /version endpoint

> Issue #1: Add a GET /version endpoint to the API · Type: feature

## Summary

- `GET /version` returns `{ "version": "<apps/api/package.json version>" }` (currently `0.0.0`).
- Public, like `/health`: no auth, no tenant context, no DB.
- Version is read from `package.json` at runtime, not hardcoded.
- A spec file beside the controller, in the style of `health.controller.spec.ts`.

## Context

`apps/api/src/health.controller.ts` and `health.service.ts` are a controller with an injected service, wired in `apps/api/src/app.module.ts`. The API is ESM (`"type": "module"`), with `rootDir: src`, so `src/*.ts` builds to `dist/*.js`. In both cases `apps/api/package.json` is `../package.json` relative to the file.

## Requirements

1. A `VersionController` at route `version` with `GET` returning `{ version: string }`.
2. A `VersionService` returns the `version` field of `apps/api/package.json`, read at runtime.
3. The path resolves under `nest start` (from `src/`) and from the built `dist/`.
4. Both are registered in `AppModule`.
5. A test covers the response shape and that the value matches `package.json`.

## Acceptance criteria

1. With the API running, `curl -i localhost:<port>/version` returns 200 and body `{"version":"0.0.0"}`, with no auth header.
2. After `pnpm build`, `node apps/api/dist/main.js` (with `API_PORT` set) answers the same `/version` call with the same body.
3. `pnpm --filter @levelpath/api test` includes `version.controller.spec.ts`, which passes. It asserts `controller.get()` equals `{ version: <version read from package.json by the test> }` and that the version is a non-empty string.
4. If `package.json` can't be read, the error is logged and rethrown. Nothing is swallowed.

## Tenant isolation and security

Not affected. The endpoint touches no database or tenant data and takes no input. It exposes only the version string of a private package, the same exposure as `/health`.

## Out of scope

Git SHA, build time or other build info. Auth. Changes to `/health`. New dependencies.

## Assumptions

- The version is read once on first use and cached in the service. A running build's version doesn't change.
- Service/controller split mirrors health, for consistency.
