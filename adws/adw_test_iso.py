#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv"]
# ///

"""ADW test (isolated): the gate on the current round.

Usage: uv run adws/adw_test_iso.py <issue-number> <adw-id>

Runs factory/bin/gate --run: the main checkout's factory/checks.sh (install,
build, lint, test) in the worktree, plus the protected-paths check. Writes
round-N/checks.md. Exit 0 on PASS, 1 on FAIL. The test agent and its JSON
parsing are gone: the exit code of the checks is the answer.
"""

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from adw_modules import pipeline  # noqa: E402
from adw_modules.state import ADWState  # noqa: E402
from adw_modules.logs import setup_logger  # noqa: E402

SCRIPT = "adw_test_iso"


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
    with pipeline.on_crash(state, logger):  # a failure ends at needs-human, never "running"
        passed = pipeline.gate(state, logger)
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pipeline.Stop as stop:
        print(f"ADW stopped: {stop}")
        sys.exit(0)
