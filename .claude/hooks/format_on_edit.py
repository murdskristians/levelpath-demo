#!/usr/bin/env -S python3 -X utf8
"""PostToolUse hook: format and lint the one file an agent just edited.

Runs Prettier (--write) on the file, and ESLint (--fix) on JavaScript and
TypeScript files, from the checkout the file belongs to (a worktree has its
own node_modules once `pnpm install` ran there). Only that file, so it stays
fast and never reformats what the agent didn't touch. .prettierignore and the
ESLint ignores still apply, so imported harness files stay verbatim.

It never blocks: the edit has already happened. When ESLint still reports
errors after --fix, it exits 2 so the agent sees them and fixes them now
instead of at the gate.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

PRETTIER = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".css", ".scss", ".html", ".yaml", ".yml"}
ESLINT = {".ts", ".tsx", ".js", ".mjs", ".cjs"}


def norm(path):
    p = str(path).replace("\\", "/")
    m = re.match(r"^/([a-zA-Z])/(.*)", p)
    return f"{m.group(1).upper()}:/{m.group(2)}" if m else p


def checkout_root(file):
    for d in file.parents:
        if (d / "package.json").exists() and (d / "pnpm-workspace.yaml").exists():
            return d
    return None


def run(args, cwd):
    # shell=True so Windows finds pnpm.cmd; the arguments are a path we quote
    cmd = " ".join(f'"{a}"' if " " in a else a for a in args)
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=120)


def main():
    event = json.load(sys.stdin)
    path = (event.get("tool_input") or {}).get("file_path")
    if not path:
        return 0
    file = Path(norm(path))
    if not file.is_absolute():
        file = Path(event.get("cwd", ".")) / file
    ext = file.suffix.lower()
    if ext not in PRETTIER or not file.exists():
        return 0
    root = checkout_root(file)
    if not root or not (root / "node_modules").exists():
        return 0  # a fresh worktree before `pnpm install`: the gate formats nothing either
    rel = file.relative_to(root).as_posix()

    run(["pnpm", "exec", "prettier", "--write", "--log-level", "warn", rel], root)
    if ext in ESLINT:
        res = run(["pnpm", "exec", "eslint", "--fix", "--no-warn-ignored", rel], root)
        if res.returncode == 1:
            print(f"ESLint errors remain in {rel} after --fix:\n{res.stdout.strip()[-3000:]}",
                  file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
