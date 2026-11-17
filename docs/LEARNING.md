# Learning log

One entry per new concept: what it is, why it matters, where it lives in this repo.

## pnpm workspaces (Phase 0)

- **What:** One repo, several packages. `pnpm-workspace.yaml` lists the folders (`apps/*`, `packages/*`). `pnpm install` once at the root installs everything and links the packages together. `pnpm -r <script>` runs a script in every package, dependencies first.
- **Why it matters:** `api`, `web` and `shared` can share code and be built and tested with one command, with a single lockfile.
- **Where:** [pnpm-workspace.yaml](../pnpm-workspace.yaml), root [package.json](../package.json) scripts.

## Shared tsconfig base (Phase 0)

- **What:** `tsconfig.base.json` holds the strict compiler options. Each package `extends` it and adds only what differs (Nest needs decorators and `NodeNext` ES modules; Vite needs JSX and `noEmit`).
- **Why it matters:** One definition of "strict", no drift between packages.
- **Where:** [tsconfig.base.json](../tsconfig.base.json), `apps/*/tsconfig.json`.

## NestJS module, controller, dependency injection (Phase 0)

- **What:** A **controller** maps HTTP routes to methods (`@Controller('health')` + `@Get()`). A **module** (`@Module`) is a box that lists the controllers and providers that belong together. **Dependency injection (DI):** a class asks for what it needs in its constructor, and Nest builds and passes it in. `HealthController` asks for a `HealthService` in its constructor, and the test builds a tiny module with `Test.createTestingModule` and asks it for the controller, the same way the app does.
- **Why it matters:** Services, guards and the database transaction context in Phase 2 all hang off this mechanism. Nest finds the constructor types through emitted _decorator metadata_ (`design:paramtypes`). Tools that strip types without emitting it (plain esbuild) break DI silently: the dependency arrives as `undefined`.
- **Where:** `apps/api/src/app.module.ts`, `health.service.ts`, `health.controller.ts`, `health.controller.spec.ts`.

## NestJS 12 is ESM-only, tested with Vitest (Phase 0)

- **What:** `@nestjs/*` 12 ships as ES modules (`"type": "module"`), and Nest 12 makes Vitest the default runner for ESM projects. So the API is an ES module: `module`/`moduleResolution` are `NodeNext`, and relative imports end in `.js` (`./health.service.js`) even though the source is `.ts`. Nest 11 (npm tag `legacy`) is the CommonJS line.
- **Why it matters:** Jest could not load `@nestjs/testing` 12 (it is ESM), which is why the approved Jest plan changed to Vitest for the API. Decision made with Chris in Phase 0.
- **Verified:** A probe test printed `Reflect.getMetadata('design:paramtypes', HealthController)` and got `HealthService`, with and without the explicit tsconfig and Vitest flags. Vite 8's Oxc transform emits the metadata on its own, so the API Vitest config needs no SWC plugin. The `emitDecoratorMetadata` flag stays in `tsconfig.json` for `nest build` (tsc).
- **Where:** `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`.

## Docker Compose healthcheck (Phase 0)

- **What:** `healthcheck` runs `pg_isready` inside the container until it succeeds. `docker compose up --wait` blocks until the service reports healthy.
- **Why it matters:** `pnpm dev` only starts the apps once Postgres actually accepts connections, instead of racing it.
- **Where:** [docker-compose.yml](../docker-compose.yml), `db:up` script in root `package.json`.

## Hooks: PreToolUse and PostToolUse (Phase 1)

- **What:** Claude Code runs a command before (PreToolUse) or after (PostToolUse) each tool call. It sends the call as JSON on stdin. Exit code 2 on PreToolUse **blocks** the call, and stderr goes back to the agent as the reason. Exit 2 on PostToolUse doesn't undo anything, but shows stderr to the agent as feedback.
- **Why it matters:** A hook is enforced by the harness, not by the model, so it holds even when a prompt is ignored, and even under `--dangerously-skip-permissions` (tested in the spike). git-adw's guard was wired `|| true`, which turned every exit 2 into 0: it never blocked anything.
- **Where:** [.claude/settings.json](../.claude/settings.json), [.claude/hooks/guard.py](../.claude/hooks/guard.py), [.claude/hooks/format_on_edit.py](../.claude/hooks/format_on_edit.py).

## Subagents, and the same agent run headless (Phase 1)

- **What:** A subagent is a markdown file in `.claude/agents/`. Its frontmatter sets the name, tools and model; its body is the system prompt. A session spawns it with the Agent tool and gets back one reply. `claude -p --agent <name>` runs the same file as a whole headless session.
- **Why it matters:** One definition per role, three drivers: `/factory run` spawns roles as subagents, the ADWs run them with `--agent`, the L1 commands spawn them. A frontmatter Stop hook fires for a subagent but **not** for an `--agent` session (spike), so the ADWs run the gate themselves.
- **Where:** [.claude/agents/](../.claude/agents/), [adws/adw_modules/agent.py](../adws/adw_modules/agent.py).

## Skills (Phase 1)

- **What:** A folder in `.claude/skills/<name>/` with a `SKILL.md`. Only its `description` is always in context; Claude loads the body when a task matches the description.
- **Why it matters:** Domain rules (NestJS endpoints, RLS, LLM calls) reach the agent when they are needed, instead of a huge `CLAUDE.md` every session pays for. The description is the trigger, so it says _when_ to use the skill.
- **Where:** [.claude/skills/](../.claude/skills/).

## Git worktrees (Phase 1)

- **What:** `git worktree add <path> -b <branch> origin/main` gives a second checkout of the same repo, on its own branch, sharing one `.git`.
- **Why it matters:** Parallel jobs each get their own files, branch, dev-server ports and (from Phase 2) database, so two agents never edit the same checkout. The main checkout stays yours.
- **Where:** `.worktrees/<job>` (factory), `trees/<adw_id>` (ADWs), `.worktrees/try-<pr>` (`/try`).

## A state machine with one writer (Phase 1)

- **What:** `factory/bin/job` is the only program that changes a job's `job.json`. Each move (`advance <job> <stage>`) is checked against a table of legal transitions and the files that justify it (no `gate` without `STATUS: READY`, no `review` without `GATE: PASS`).
- **Why it matters:** The orchestrating agent can't skip a step or invent a state. When the session dies, the files say exactly where to resume.
- **Where:** [factory/bin/job](../factory/bin/job) (`TRANSITIONS`).

## The gate: a deterministic judge (Phase 1)

- **What:** `factory/checks.sh` runs install, build, lint and test, run by `factory/bin/gate` from the main checkout inside the job's worktree. It is pass/fail by exit code, and it also fails a branch that changed a protected harness file.
- **Why it matters:** "It works" is decided by a script, not an LLM opinion. No reviewer runs on a failing build, and a branch can't edit the checks it is judged by.
- **Where:** [factory/checks.sh](../factory/checks.sh), [factory/bin/gate](../factory/bin/gate).

## Routing by risk (Phase 1)

- **What:** Intake rates each job's risk (`low`, `medium`, `high`) and surfaces (`api`, `ui`, `db`, `llm`, `security`). A table maps them to the reviewers that run and the model each uses.
- **Why it matters:** Cost goes where the risk is: a low-risk change gets sonnet and haiku reviewers, a high-risk one gets an opus planner, builder and security reviewer.
- **Where:** [factory/config.json](../factory/config.json) `routing`, `surface_reviewers`, `builder_models`.

## File contracts instead of parsing prose (Phase 1)

- **What:** Every role writes one known file whose first line is the answer: `DECISION:`, `STATUS:`, `GATE:`, `VERDICT:`, `READY | ESCALATE`. Drivers read that line; they never parse the agent's chat.
- **Why it matters:** git-adw parsed paths and JSON out of replies, and "Plan file does not exist" was a sentence printed before the path. A file contract can't be broken by a chatty agent.
- **Where:** [docs/HARNESS.md](HARNESS.md) ("A run, step by step").

## Prompt injection and untrusted input (Phase 1)

- **What:** Text a stranger can write (a public issue, a purchase description) can contain instructions aimed at the agent.
- **Why it matters:** Issue text reaches agents only as quoted data in `issue.md`, with a note that it is data, not instructions. The ADW trigger acts only on the owner's comments. Phase 4's LLM call validates the output against a schema, so injected text can't produce anything but a fallback.
- **Where:** `issue.md` in every job folder, [adws/adw_triggers/trigger_cron.py](../adws/adw_triggers/trigger_cron.py), the `llm-call` skill.
