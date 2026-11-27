#!/usr/bin/env -S python3 -X utf8
"""PreToolUse hook of the planner and the builder: query the code graph before reading code.

Wired in the two roles' frontmatter (`.claude/agents/planner.md`, `builder.md`), so it
runs for them in every driver and for no other agent. It does nothing unless
`<main checkout>/graphify-out/graph.json` exists: without a graph, the hook is
inert.

With the graph, the agent's first look at source code (`apps/`, `packages/`, `db/`)
is blocked until it has run one `graphify query`, `explain` or `path`. The reason it
prints on stderr (exit 2) tells the agent the command. After one query, everything
is allowed for the rest of that agent's run. Job files, docs, templates and git,
pnpm and the gate are never blocked.

Every decision is appended to graphify-out/graph-first.log.jsonl, the evidence of
what the hook did. Stdlib only.
"""

import json
import os
import re
import sys
import time
from pathlib import Path

CODE = re.compile(r"(^|[\\/\s\"'=])(apps|packages|db)([\\/]|$)")
READERS = re.compile(r"(^|[;&|(]\s*|\s)(cat|head|tail|sed|grep|rg|find|ls|less|more|awk|type|Get-Content|Select-String)\b")
QUERY = re.compile(r"(^|[;&|(]\s*|\s)graphify\s+(query|explain|path)\b")


def main():
    try:
        event = json.loads(sys.stdin.read() or "{}")
    except ValueError as err:
        print(f"graph_first: unreadable hook input, allowing: {err}", file=sys.stderr)
        return 0
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or ".")
    out = root / "graphify-out"
    if not (out / "graph.json").exists():
        return 0  # no graph: the hook is inert
    tool, inp = event.get("tool_name", ""), event.get("tool_input") or {}
    # One query per agent: subagents share their parent's session_id, so the role name is part of the key
    who = event.get("agent_id") or f"{event.get('session_id') or 'unknown'}-{event.get('agent_type') or 'main'}"
    key = re.sub(r"[^\w.-]", "_", str(who))
    marker = out / ".graph-first" / key

    def log(action):
        rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "key": key, "agent_type": event.get("agent_type"),
               "tool": tool, "action": action, "input_keys": sorted(event)}
        try:
            with open(out / "graph-first.log.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
        except OSError as err:
            print(f"graph_first: can't write the log: {err}", file=sys.stderr)

    if tool == "Bash" and QUERY.search(inp.get("command", "")):
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("queried\n", encoding="utf-8")
        log("query")
        return 0
    if marker.exists():
        return 0
    if tool == "Read":
        reads_code = bool(CODE.search(inp.get("file_path", "")))
    elif tool in ("Grep", "Glob"):
        where = f"{inp.get('path', '')} {inp.get('pattern', '')} {inp.get('glob', '')}"
        reads_code = bool(CODE.search(where)) or not inp.get("path")
        if re.search(r"(^|[\\/\s])(agents|factory|docs|\.claude)[\\/]", where):
            reads_code = False
    elif tool == "Bash":
        cmd = inp.get("command", "")
        reads_code = bool(READERS.search(cmd)) and bool(CODE.search(cmd))
    else:
        reads_code = False
    if not reads_code:
        return 0
    log("blocked")
    print(f"graph_first: this repo has a code graph. Find the code with it before reading or searching "
          f"source files: `cd {root.as_posix()} && graphify query \"<what you are looking for>\"` "
          f"(or `graphify explain \"<symbol>\"`, `graphify path \"<A>\" \"<B>\"`). Then read only the "
          f"lines it points to. One query unblocks reading for the rest of your run.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
