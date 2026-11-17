"""Git helpers for the ADWs.

The builder role commits, pushes and opens the draft PR itself (the same
contract as in the factory), so the ADWs need almost nothing here. What this
module no longer has is the point: `approve_pr` and `merge_pr` are gone. No
driver can approve or merge a PR; a person merges every PR (D9).
"""

import subprocess
from typing import Optional


def get_current_branch(cwd: Optional[str] = None) -> str:
    """Get current git branch name."""
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True, text=True, cwd=cwd,
    )
    return result.stdout.strip()


def is_pushed(cwd: str, branch: str) -> bool:
    """True when origin/<branch> exists and equals the local HEAD."""
    subprocess.run(["git", "fetch", "origin", branch], capture_output=True, text=True, cwd=cwd)
    head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=cwd)
    remote = subprocess.run(["git", "rev-parse", f"origin/{branch}"], capture_output=True, text=True, cwd=cwd)
    return remote.returncode == 0 and head.stdout.strip() == remote.stdout.strip()


def is_clean(cwd: str) -> bool:
    res = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, cwd=cwd)
    return res.returncode == 0 and not res.stdout.strip()


def head_commit(cwd: str) -> str:
    return subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=cwd).stdout.strip()
