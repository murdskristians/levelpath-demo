# Intent: Suggested fields from a free-text description

<!-- Drafted by Claude from KICKOFF Phase 4, the llm-call skill and Chris's seven decisions (2026-11-21). Chris to confirm. -->

## Problem

A requester knows what they need in one sentence ("need 20 laptops for new sales hires, ~€1,200 each, prefer Dell"), but the New request form asks them to work out a title, a total in cents, a currency and a supplier by hand. Purchase requests also have no description or category today, although KICKOFF's data model lists both. So the approver sees numbers without the reason behind them.

## Outcome

In the New request form, a requester writes a description and clicks **Suggest fields**. A moment later the title, category, amount, currency and supplier are filled in. Every field stays editable, and nothing is created until they click Create. When the model is slow, wrong or unavailable, the form stays as it was, with a short note to fill it in by hand: the app never breaks because the LLM did. Every request then carries its description and category, and the approver sees both when deciding.

## Users and roles

- **Requester and approver:** anyone who can create a request can ask for a suggestion, for their own company only.
- **Approver:** sees the description and category of each request waiting for their decision.
- **Tenants:** the model only ever sees the caller's own company's suppliers, and may only suggest one of them.

## Constraints

- **Decided (Chris):**
  - **Storage:** migration 0005 adds `description` and `category` to purchase requests. The suggestion also proposes a quantity, which helps the model work out the total but is not stored.
  - **Categories:** a fixed list, shared like the status list (database CHECK + `packages/shared`): `hardware`, `software`, `office_supplies`, `services`, `travel`, `other`.
  - **Required fields:** category is required for new requests. The description is optional free text, up to 2000 characters. Existing rows get category `other` and an empty description.
  - **Trigger:** a Suggest fields button. One call per click, never while typing.
  - **Live LLM:** the mock provider is the default everywhere: tests, dev, the demo, CI. The real Anthropic provider is used only with `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env`, which Chris adds himself. Evals against it run only when Chris says so; Claude asks before every paid run.
  - **Driver:** L1, pairing: `/spec` → `/plan` → build → `/verify` → `/review`, with LEARNING.md entries for each hardening rule.
- **From the `llm-call` skill:**
  - **Interface:** one interface, `SuggestionProvider`, with a deterministic `MockProvider` and an `AnthropicProvider`.
  - **The model name** comes from Anthropic's current models overview when the code is written, not from memory.
  - **Hardening, in order:**
    1. a timeout on every call;
    2. the output is validated with a shared Zod schema;
    3. one repair retry that tells the model the validation errors, with the total attempts capped;
    4. then fallback: "no suggestion", never an error page.
  - **The description is untrusted input.** It goes into the prompt as delimited data, never as instructions. A suggested supplier that isn't one of the caller's company's suppliers is dropped.
  - **Logs:** one structured line per call: provider, model, latency, attempts, validation failures and outcome. Never the description or the model's raw output (lengths and a hash at most).
- **From Phases 2 and 3:** the suggestion route runs inside `withTenant` like every other route. The contract (shared Zod schemas) lands on `main` before the code that uses it. The tests use the real database, with only the LLM provider faked.
- **Evals** live in `evals/`: 10–20 realistic descriptions with expected fields, plus tricky ones (no amount, two currencies, a prompt-injection attempt, a supplier from another company). A runner reports the pass rate. They run on demand only.

## Out of scope

- Suggestions while typing, streaming, chat, or several suggestions to pick from.
- Editing existing requests (still create, submit, decide only).
- Storing quantity, line items or unit prices; new suppliers proposed by the model.
- Caching, rate limiting per user, a cost dashboard for LLM calls.
- CI (Phase 5).

## Open questions

- **For the spec:** the suggestion route and its error codes, the timeout and attempt cap, and how the UI shows "suggested" fields and the fallback note.
- **Order of work:** issue #10 (UI polish) changes the same form. It should merge before the Phase 4 UI step starts, to avoid conflicts.
