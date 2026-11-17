#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv", "pydantic"]
# ///

"""ADW SDLC (isolated): the whole run, headless.

Usage: uv run adws/adw_sdlc_iso.py <issue-number> [adw-id]

plan (intake → route → worktree → scout → planner), then rounds of build →
gate → reviewers until every reviewer passes or the rounds run out, then the
approver. Ends with a ready PR labelled for a human: you merge it. No document
or ship phase: docs are part of the builder's definition of done, and
shipping is your merge (D9).
"""

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from adw_modules import pipeline  # noqa: E402
from adw_modules.state import ADWState  # noqa: E402
from adw_modules.utils import setup_logger  # noqa: E402

SCRIPT = "adw_sdlc_iso"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    issue = args[0]
    state, logger = pipeline.start(issue, args[1] if len(args) > 1 else None, SCRIPT, lambda i: setup_logger(i, SCRIPT))
    pipeline.sdlc(state, logger)
    print(f"Run {state.get('adw_id')} ended at stage {state.get('stage')}.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pipeline.Stop as stop:
        print(f"ADW stopped: {stop}")
        sys.exit(0)
