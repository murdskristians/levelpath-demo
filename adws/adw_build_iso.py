#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv"]
# ///

"""ADW build (isolated): one builder round.

Usage: uv run adws/adw_build_iso.py <issue-number> <adw-id>

Runs the builder role in the run's worktree for the next round. It commits,
pushes and opens the draft PR, and writes build.md (STATUS: READY | BLOCKED).
Requires adw_plan_iso.py first.
"""

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from adw_modules import pipeline  # noqa: E402
from adw_modules.state import ADWState  # noqa: E402
from adw_modules.logs import setup_logger  # noqa: E402

SCRIPT = "adw_build_iso"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 2
    issue, adw_id = args[0], args[1]
    state = ADWState.load(adw_id)
    if not state or str(state.get("issue_number")) != issue:
        print(f"No ADW run {adw_id} for issue #{issue} (agents/{adw_id}/adw_state.json)")
        return 1
    logger = setup_logger(adw_id, SCRIPT)
    reason = "This is round 1: implement spec.md following plan.md." if not state.get("round") else         f"Read round-{state.get('round')}/ (checks and reviews) and fix what failed, push, and update build.md."
    pipeline.build(state, logger, reason)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pipeline.Stop as stop:
        print(f"ADW stopped: {stop}")
        sys.exit(0)
