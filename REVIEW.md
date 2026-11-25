# REVIEW.md

How every review in this repo is done, by every driver: `/review` (you), `/factory run` and the ADWs. The reviewers read this file; so should a human reviewing a PR.

## The passes

Each pass is one agent with one lens. They run in parallel on the same commit, after the gate (`factory/checks.sh`) has passed.

| Pass       | Agent               | Question it answers                                                                             |
| ---------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `verify`   | `verifier`          | Does it work? It runs the app and exercises every acceptance criterion, with screenshots.       |
| `bugs`     | `reviewer-bugs`     | Is the code correct, simple and tested?                                                         |
| `spec`     | `reviewer-spec`     | Is it what was asked: every requirement met, nothing extra?                                     |
| `security` | `reviewer-security` | Can a tenant, user or input cross a boundary? Runs when intake flags `db`, `llm` or `security`. |

## Important or Nit

Every finding is one or the other. One Important finding makes the verdict `CHANGES`; Nits never do.

**Important** (must be fixed before merge):

- A bug: wrong result, crash, unhandled error or rejected promise on a real path, race, off-by-one.
- A requirement or acceptance criterion from the spec that isn't met, or behaviour the spec rules out.
- Tenant isolation: a query that can read or write another tenant's rows, a table without RLS enabled and forced, a connection that bypasses the tenant transaction, a crafted ID that works across tenants.
- Security: auth or role checks missing, user input reaching SQL, HTML, a shell or a prompt unvalidated, secrets in code, personal data in logs.
- LLM output used without schema validation, or a missing timeout or fallback.
- Tests: new behaviour without a test where a runner exists; an existing test weakened, skipped or rewritten to pass.
- Data: a migration that loses data, or edits an applied migration.
- A rule in `CLAUDE.md`'s Rules broken, such as a `catch` that neither logs nor rethrows ("never silently fail"), wherever it is: TypeScript or an inline script.

**Nit** (worth saying, never blocking):

- Naming, small duplication, a clearer structure, a missing comment on tricky code, a better error message.

## Rules

- **Nit cap: at most 5 Nits per review.** Keep the most useful; drop the rest.
- **Skip what the gate already checks:** formatting, lint and type errors. `checks.sh` passed on this commit.
- **Skip taste.** If two ways are both fine, say nothing.
- **Pre-existing problems** the change didn't make worse go under Notes, not Findings.
- **Be exact:** `path:line`, the problem, and the fix you want. Prove it if you can (a command and its output).
- **Never fix anything.** Reviewers read and report; the builder fixes.

## The review file

```markdown
VERDICT: PASS | CHANGES

## Summary

- 3 to 5 short bullets a human can skim

## Findings

1. Important: <path:line> <the problem and the fix you want>
2. Nit: <path:line> <...>

## Notes

Non-blocking observations. Optional.
```

The first line is exactly `VERDICT: PASS` or `VERDICT: CHANGES`. Under Findings, write "None." when there are none.

## Where the tiers come from

This scale merges the scales of the three harnesses it replaces:

- **git-adw:** `blocker` became Important; `tech_debt` and `skippable` became Nit.
- **tac-combined:** Blocker and High became Important; Medium and Low became Nit.
- **The factory:** CHANGES and PASS stay as the verdict.
