# <short title>

> Issue #<n>: <issue title> · Type: feature | bug | chore · Intent: docs/intent/<slug>.md (if any)

<!-- WHAT and HOW TO CHECK IT. Written by the planner. The builder tests against the acceptance criteria, the verifier exercises them, reviewer-spec traces them to the diff, the approver checks them. -->

## Summary

- 3 to 5 short bullets a human can skim

## Context

Where this lives: the files, modules, tables and components involved and how they work today. Cite paths.

## Requirements

1. What must be true when the work is done.

## Acceptance criteria

1. One observable behaviour plus how to verify it: a command and its expected output, an endpoint call and its response, or a page and what it shows. Checkable by someone who only has the repo.

## Tenant isolation and security

How the change keeps tenant A away from tenant B's data (RLS, the tenant transaction), and any auth, input or PII concern. "Not affected" with a reason is a valid answer.

## Out of scope

What a reasonable builder might be tempted to do but must not.

## Assumptions

Decisions made where the request was ambiguous, each with a one-line reason. A product decision here makes the approver escalate.
