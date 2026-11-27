#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv"]
# ///

"""ADW review (isolated): the routed reviewers, then the approver.

Usage: uv run adws/adw_review_iso.py <issue-number> <adw-id>

Runs every reviewer routed for this run in parallel (verify, bugs, spec, and
security when routed) on the current round. All PASS → the approver writes
READY or ESCALATE, the PR is marked ready, and the issue is labelled for a
human. Any CHANGES → it reports them; run adw_build_iso.py for the next round,
or adw_sdlc_iso.py to loop. Never merges.
"""

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from adw_modules import pipeline  # noqa: E402
from adw_modules.state import ADWState  # noqa: E402
from adw_modules.logs import setup_logger  # noqa: E402

SCRIPT = "adw_review_iso"


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
        verdicts = pipeline.review(state, logger)
        if all(v == "PASS" for v in verdicts.values()):
            pipeline.approve(state, logger)
    if not all(v == "PASS" for v in verdicts.values()):
        print(f"Changes requested: {verdicts}")
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pipeline.Stop as stop:
        print(f"ADW stopped: {stop}")
        sys.exit(0)
