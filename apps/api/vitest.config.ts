import { defineConfig } from 'vitest/config';

// Vite 8 / Vitest 5 transform TypeScript with Oxc, which emits the decorator metadata Nest's
// dependency injection needs. Verified with a probe (see docs/LEARNING.md), so no extra plugin.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // Creates this run's own database (lp_<random>), migrates and seeds it, and drops it at
    // the end. The tests need Postgres up: `pnpm db:up`.
    globalSetup: ['./test/global-setup.mjs'],
    // The spec files share that one database, so they run one after another.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
