import { defineConfig } from 'vitest/config';

// Vite 8 / Vitest 5 transform TypeScript with Oxc, which emits the decorator metadata Nest's
// dependency injection needs. Verified with a probe (see docs/LEARNING.md), so no extra plugin.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
