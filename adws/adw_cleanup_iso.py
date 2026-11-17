#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv"]
# ///

"""ADW cleanup (isolated): close out a run after a person merged or closed its PR.

Usage: uv run adws/adw_cleanup_iso.py <issue-number> <adw-id>

The factory does this itself (`factory/bin/job queue` notices the merge). For an
ADW run, run this after the merge: it checks the PR is merged or closed, removes
the worktree trees/<adw-id> (also when its paths are too long for git on
Windows), deletes the local branch, takes the `factory:needs-human` label off
the issue and records the run as merged or closed. It never merges anything.
"""

import os
import subprocess
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from adw_modules import gh, roles, worktrees  # noqa: E402
from adw_modules.logs import setup_logger  # noqa: E402
from adw_modules.state import ADWState  # noqa: E402

SCRIPT = "adw_cleanup_iso"


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    issue, adw_id = sys.argv[1], sys.argv[2]
    state = ADWState.load(adw_id)
    if not state or str(state.get("issue_number")) != issue:
        print(f"No ADW run {adw_id} for issue #{issue} (agents/{adw_id}/adw_state.json)")
        return 1
    logger = setup_logger(adw_id, SCRIPT)
    pr = state.get("pr_number")
    pr_state = gh.pr_state(pr) if pr else "NONE"
    if pr_state == "OPEN":
        print(f"PR #{pr} is still open: review and merge it (or close it) first.")
        return 1
    worktrees.remove(adw_id)
    if state.get("branch_name"):
        subprocess.run(["git", "branch", "-D", state.get("branch_name")], capture_output=True, text=True,
                       cwd=str(roles.REPO))
    gh.remove_label(issue, roles.CONFIG["labels"]["needs_human"])
    stage = "merged" if pr_state == "MERGED" else "closed"
    state.update(stage=stage)
    state.save(SCRIPT)
    logger.info(f"Run {adw_id}: {stage}. Worktree and local branch removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
