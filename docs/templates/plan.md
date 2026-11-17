# Plan: <short title>

> Spec: <path to spec.md> · Type: feature | bug | chore

<!-- HOW. Written by the planner after the spec. Sections marked (feature), (bug) or (chore) apply to that type only. -->

## Approach

The solution in a few sentences, and why this way over the obvious alternative.

## Steps to reproduce (bug)

Exact steps or a failing test that shows the bug before the fix.

## Root cause (bug)

Why it happens, with the file and line.

## Libraries and versions

Every library, runner or tool the plan adds or relies on, checked, not remembered: the current major, its module format (ESM or CJS) and its peer-dependency ranges (`pnpm view <pkg> dist-tags peerDependencies`). Write "None" if nothing new.

## Files

- `path` — what changes and why.

### New files

- `path` — what it is.

## Steps

### 1. <first step>

- Foundational shared changes first (schemas in `packages/shared`, migrations), then the API, then the UI.
- Include writing the tests in the step that adds the behaviour.

### N. Validate

Run the validation commands below.

## Tests

- Unit and integration tests to add, and the edge cases they cover. For data access: a test that proves tenant A cannot select, update or delete tenant B's rows.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

Plus any command that proves this change: an endpoint call, a script, a page to open.

## Notes

Anything else the builder should know.
