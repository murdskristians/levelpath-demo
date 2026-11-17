#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv", "pydantic"]
# ///

"""ADW plan (isolated): intake, routing, worktree, scout, planner.

Usage: uv run adws/adw_plan_iso.py <issue-number> [adw-id]

Runs the shared roles headless: intake (ACCEPT / NEEDS-INFO / REJECT, type,
risk, surfaces) → routing from factory/config.json → a worktree in
trees/<adw-id> on branch adw/<adw-id>-<slug> from origin/main → scout (high
risk only) → planner (spec.md + plan.md). Everything lands in agents/<adw-id>/.
"""

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from adw_modules import pipeline  # noqa: E402
from adw_modules.state import ADWState  # noqa: E402
from adw_modules.utils import setup_logger  # noqa: E402

SCRIPT = "adw_plan_iso"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    state, logger = pipeline.start(args[0], args[1] if len(args) > 1 else None, SCRIPT, lambda i: setup_logger(i, SCRIPT))
    pipeline.plan(state, logger)
    print(f"Planned. Next: uv run adws/adw_build_iso.py {args[0]} {state.get('adw_id')}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pipeline.Stop as stop:
        print(f"ADW stopped: {stop}")
        sys.exit(0)
