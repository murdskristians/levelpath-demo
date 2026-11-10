# Harness changelog

Every time a mistake is corrected or a check catches something, and every time the imported harness is adapted, add an entry. This file shows how the harness evolved.

Format:

```
## YYYY-MM-DD: short title
- **What went wrong / what was missing:**
- **Before:**
- **After (harness change: CLAUDE.md line, skill, hook, eval):**
- **Why this prevents a repeat:**
```

<!-- Entries go below, newest last. -->

## 2026-11-10: Plan assumed package versions without checking them

- **What went wrong:** The approved Phase 0 plan chose Jest for the API, assuming NestJS was CommonJS. `pnpm add` installed Nest 12 (npm `latest`), which is ESM-only, and `pnpm test` failed ("Must use import to load ES Module: @nestjs/testing"). Same class of problem: `pnpm add typescript` installed 7.0.2, which `typescript-eslint` (peer `<6.1.0`) rejects, so TypeScript is pinned to 5.9.3.
- **Before:** Plan written from memory of how the ecosystem looked. No step to check current majors, module format or peer ranges.
- **After:** The failing `pnpm test` caught it; fork resolved with Chris (Nest 12 ESM + Vitest). **Pending harness change (add in Phase 1):** a line in `CLAUDE.md` "Things Claude gets wrong" and a step in the `planner`/`feature-workflow` skill: _before a plan names a library or runner, check the current major, its module format (ESM/CJS) and peer-dependency ranges (`pnpm view <pkg> dist-tags peerDependencies`), and put the result in the plan._
- **Why this prevents a repeat:** Version and compatibility facts enter the plan as checked evidence, so the fork surfaces at planning time instead of as a failed build.
