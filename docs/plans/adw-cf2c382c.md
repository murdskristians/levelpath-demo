# Plan: Page footer with app name and current year

> Spec: agents/cf2c382c/spec.md · Type: feature

## Approach

Add a semantic `<footer>` sibling after `<main>` in `App`, wrapped in a fragment. Compute the year inline during render. Style it in `App.css`. Test with `vi.useFakeTimers` plus `vi.setSystemTime`. This is simpler than a separate Footer component, which one line of JSX doesn't justify.

## Libraries and versions

None. Vitest ^5.1.0 and Testing Library are already installed. Fake timers are built into Vitest.

## Files

- `apps/web/src/App.tsx` — wrap in a fragment, add the footer.
- `apps/web/src/App.css` — footer styles.
- `apps/web/src/App.test.tsx` — footer test.

### New files

None.

## Steps

### 1. Footer markup and style

- In `App.tsx`, return `<>…<main>…</main><footer>Levelpath Demo · {new Date().getFullYear()}</footer></>`. Check that the rendered text is a single string: use a template literal, `{`Levelpath Demo · ${year}`}`, so `getByText` matches one text node.
- In `App.css`, add `footer` with `box-sizing: border-box; max-width: 40rem; margin: 0 auto; padding: 1rem; text-align: center; font-size: 0.875rem; color: #4b5563; overflow-wrap: anywhere;`. #4b5563 on white keeps AA contrast.

### 2. Test

- In `App.test.tsx`, add `vi` to the vitest import. Add a test that calls `vi.useFakeTimers()` and `vi.setSystemTime(new Date(2031, 5, 15))`, renders `App`, and expects `screen.getByRole('contentinfo').textContent` to be `Levelpath Demo · 2031`. Call `vi.useRealTimers()` in `afterEach`.
- Use a local-time date constructor so the timezone can't shift the year.

### 3. Validate

Run the validation commands below.

## Tests

- Footer shows the app name and the faked year (2031), which proves the year isn't hard-coded.
- Existing App tests are unchanged.
- No data access, so no tenant isolation test.

## Validation commands

```bash
pnpm build
pnpm lint
pnpm test
```

Then run the web app on a chosen port, check the footer visually at desktop and 320px width, and stop it with `factory/bin/port stop <port>`.

## Notes

- Run `pnpm lint` as a check only. If Prettier complains, format the files by hand to match.
- No CLAUDE.md or LEARNING.md update is needed, since there is no new concept.
