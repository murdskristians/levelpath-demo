"""Worktrees and ports for ADW runs: each run builds in trees/<adw_id>, on its own branch and ports.

The factory's jobs use .worktrees/<job> and ports from 5100; the ADWs use
trees/<adw_id> and ports from 9100 (API) and 9200 (web), so the two drivers
never collide.
"""

import os
import shutil
import socket
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import Tuple

REPO = Path(__file__).resolve().parents[2]
SLOTS = 15


def path_of(adw_id: str) -> Path:
    return REPO / "trees" / adw_id


def git(*args: str, cwd: Path = REPO) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def create(adw_id: str, branch: str, base: str) -> Path:
    """A new branch from origin/<base>, checked out in trees/<adw_id>. Reuses an existing one."""
    path = path_of(adw_id)
    if path.exists():
        return path
    path.parent.mkdir(exist_ok=True)
    git("fetch", "origin", base)
    res = git("worktree", "add", "-b", branch, str(path), f"origin/{base}")
    if res.returncode != 0 and "already exists" in res.stderr:
        res = git("worktree", "add", str(path), branch)
    if res.returncode != 0:
        raise RuntimeError(f"couldn't create the worktree: {res.stderr.strip()}")
    return path


REMOVE_TRIES, REMOVE_WAIT = 4, 5  # up to ~15 s for Windows to let go of a stopped server's files


def remove(adw_id: str) -> bool:
    """Remove trees/<adw_id>. False (with the reason on stderr) when the folder is still there."""
    path = path_of(adw_id)
    res = git("worktree", "remove", "--force", str(path))
    if res.returncode != 0 and path.exists():
        # git can't delete paths over 260 characters on Windows ("Filename too long"), and
        # pnpm's node_modules have them; a process that just stopped can hold files for a
        # few seconds (WinError 32), so retry
        for attempt in range(REMOVE_TRIES):
            try:
                rmtree_long(path)
                break
            except OSError as e:
                if attempt + 1 < REMOVE_TRIES:
                    time.sleep(REMOVE_WAIT)
                    continue
                print(f"worktrees: couldn't remove {path} after {REMOVE_TRIES} tries: {e}. Close whatever "
                      "still has files open there, delete the folder, then run `git worktree prune`.",
                      file=sys.stderr)
    git("worktree", "prune")
    return not path.exists()


def rmtree_long(path) -> None:
    """Delete a folder even past Windows' 260-character path limit, and even when git
    made files read-only."""
    def writable(func, p, _exc):
        os.chmod(p, stat.S_IWRITE)
        func(p)

    full = os.path.abspath(path)
    if os.name == "nt":
        full = "\\\\?\\" + full[0].upper() + full[1:]  # the \\?\ prefix lifts the limit
    shutil.rmtree(full, onexc=writable)


def _free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def ports(adw_id: str) -> Tuple[int, int]:
    """(API, web) ports: a slot from the id, the next free one if it's taken."""
    start = int(adw_id[:8], 16) % SLOTS if all(c in "0123456789abcdef" for c in adw_id[:8]) else 0
    for offset in range(SLOTS):
        slot = (start + offset) % SLOTS
        api, web = 9100 + slot, 9200 + slot
        if _free(api) and _free(web):
            return api, web
    raise RuntimeError("no free ports in 9100-9114 / 9200-9214")
