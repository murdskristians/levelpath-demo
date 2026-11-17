#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv"]
# ///

"""Can this machine run the ADWs? One line per prerequisite, exit 0 when all pass.

Usage: uv run adws/adw_tests/health_check.py [--call-claude]

Checks git and its origin remote, gh and its login, the claude CLI, uv, the
factory's gate and agent-browser. --call-claude also makes one tiny headless
call (haiku, 1 turn, capped at $0.05) to prove the subscription login works; it
is the only check that spends tokens.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from adw_modules import gh  # noqa: E402
from adw_modules.agent import CLAUDE_PATH, get_claude_env  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def run(*cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", **kw)


def claude_cli():
    out = run(CLAUDE_PATH, "--version").stdout.strip()
    if not out:
        raise RuntimeError("claude not found; set CLAUDE_CODE_PATH")
    return out


def uv():
    return shutil.which("uv") or _fail("uv is not on PATH")


def factory():
    for rel in ("factory/bin/gate", "factory/checks.sh", "factory/config.json"):
        if not (REPO / rel).exists():
            _fail(f"{rel} is missing")
    return "factory/bin/gate, factory/checks.sh"


def browser():
    return shutil.which("agent-browser") or "not installed: the verifier won't be able to look at pages"


def claude_call():
    res = run(CLAUDE_PATH, "-p", "--model", "haiku", "--max-turns", "1", "--max-budget-usd", "0.05",
              "--output-format", "json", input="Reply with exactly: ok", env=get_claude_env())
    data = json.loads(res.stdout or "{}")
    if data.get("is_error") or "ok" not in (data.get("result") or "").lower():
        _fail(f"unexpected reply: {(res.stdout or res.stderr)[:200]}")
    return f"ok, ${float(data.get('total_cost_usd') or 0):.4f}"


def _fail(message):
    raise RuntimeError(message)


def main() -> int:
    checks = [
        ("git repository with an origin remote", gh.repo),
        ("gh is logged in", gh.operator),
        ("claude CLI", claude_cli),
        ("uv", uv),
        ("the factory's gate", factory),
        ("agent-browser", browser),
    ]
    if "--call-claude" in sys.argv:
        checks.append(("a headless claude call on the subscription", claude_call))
    failed = 0
    for name, check in checks:
        try:
            print(f"PASS {name}: {check()}")
        except Exception as e:  # report every failure, then exit non-zero
            failed += 1
            print(f"FAIL {name}: {e}")
    print("all good" if not failed else f"{failed} check(s) failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
