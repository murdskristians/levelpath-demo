# Credits

This repo's agent harness is built from three earlier harnesses, and uses graphify for its code graph. What came from where, and what changed, is in [docs/HARNESS.md](docs/HARNESS.md) and [docs/HARNESS_CHANGELOG.md](docs/HARNESS_CHANGELOG.md).

## Software Factory for Claude Code (v2), by ZazenCodes

- Source: <https://github.com/zazencodes/zazencodes-season-3/tree/main/src/software-factory-claude-code-v2>
- Via the Windows-ready fork: <https://github.com/murdskristians/zazencodes-season-3/tree/main/src/software-factory-claude-code-v2>
- Licence: **GPLv3**. The files taken from it and the ones adapted from it are distributed under GPLv3, which is why this repository is GPLv3 (see [LICENSE](LICENSE)).
- Used for: the `/factory` skill, `factory/bin/{job,gate,route,port}`, `factory/dashboard.html`, and the intake, builder, approver and reviewer agents the roles are built from.

## Tactical Agentic Coding and multi-agent orchestration, by IndyDevDan

- The AI Developer Workflow (ADW) design behind `adws/` (PITER: issue as prompt, trigger, isolated worktree, review), from git-adw, a private course repository. The code in `adws/` is written for this repository.
- The orchestrator pattern (an agent that creates, commands and watches other agents) that inspired the control room and the scout role, from tac-combined, a private fork of multi-agent-orchestration. No code from it is in this repository.
- All credit for the original architecture belongs to IndyDevDan.

## graphify, by Safi Shamsi

- Source: <https://github.com/Graphify-Labs/graphify> (the `graphifyy` package, version 0.9.119, installed with `uv tool install graphifyy`).
- Licence: **Apache 2.0**, Copyright 2026 Safi Shamsi and the Graphify contributors (relicensed from MIT; earlier portions stay under MIT). Its licence and NOTICE are kept next to the skill: [.claude/skills/graphify/LICENSE](.claude/skills/graphify/LICENSE) and [NOTICE](.claude/skills/graphify/NOTICE). Apache 2.0 is compatible with GPLv3.
- Used for: the code graph the planner and builder query (`graphify query`, `explain`, `path`), its git hooks that keep the graph current, the advisory hooks in `.claude/settings.json`, and the skill in `.claude/skills/graphify/`, which is graphify's own, installed by `graphify claude install --project`.
- Written here: `.claude/hooks/graph_first.py`, which makes the planner and builder query the graph before they read code.

## This repo

The Windows ports, the no-merge rule, the shared roles and their three drivers, the guard hooks, the skills and the app are by Chris (murdskristians).
