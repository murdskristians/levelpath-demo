#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv"]
# ///

"""ADW patch (isolated): your feedback on a run that waits for you.

Usage: uv run adws/adw_patch_iso.py <issue-number> <adw-id> "<feedback>"

Saves the feedback as feedback-<k>.md and runs more rounds (build → gate →
reviewers → approver) with a fresh round budget. The trigger calls it for an
`adw patch` comment, with the rest of the comment as the feedback.
"""

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from adw_modules import pipeline  # noqa: E402
from adw_modules.state import ADWState  # noqa: E402
from adw_modules.logs import setup_logger  # noqa: E402

SCRIPT = "adw_patch_iso"


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
    feedback = " ".join(args[2:]).strip()
    if not feedback:
        print("Give the feedback as the third argument.")
        return 2
    pipeline.patch(state, logger, feedback)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pipeline.Stop as stop:
        print(f"ADW stopped: {stop}")
        sys.exit(0)
