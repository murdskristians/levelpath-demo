import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'graphify-out/**',
      'KICKOFF.md',
      // Harness: imported prompts and scripts stay verbatim; runtime folders hold
      // full checkouts of this repo that must not be linted twice.
      '.claude/**',
      'adws/**',
      'factory/**',
      '.worktrees/**',
      'trees/**',
      'agents/**',
      'logs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
