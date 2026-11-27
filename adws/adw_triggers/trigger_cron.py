#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["schedule", "python-dotenv"]
# ///

"""The T in PITER: start ADW runs from GitHub issue comments. Opt-in.

Usage: uv run adws/adw_triggers/trigger_cron.py

Polls the repo's open issues every ADW_POLL_SECONDS (default 60) and starts a
run only for a new comment **by the operator** (the account `gh` is logged in
as) whose first line is exactly:

  adw              → adw_sdlc_iso.py on the issue (resumes a run waiting on NEEDS-INFO)
  adw patch        → adw_patch_iso.py on the issue's latest run; the rest of the
                     comment is the feedback

Anything else is ignored: new issues, other people's comments (the repo is
public, so issue text is untrusted input), and the ADWs' own `[ADW-BOT]`
comments. Comments that already exist when the trigger starts are never
acted on. No LLM is asked what a comment means. Nothing runs on a schedule
unless you start this script, and it never merges anything.
"""

import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

import schedule
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from adw_modules import gh  # noqa: E402
from adw_modules.pipeline import latest_run  # noqa: E402
from adw_modules.state import ADWState  # noqa: E402

load_dotenv()

POLL_SECONDS = max(60, int(os.getenv("ADW_POLL_SECONDS", "60")))
ADWS = Path(__file__).resolve().parents[1]
REPO_PATH = gh.repo()
OPERATOR = gh.operator()

STARTED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # gh's createdAt format
seen: Dict[int, Optional[str]] = {}  # issue → id of the last comment looked at
shutdown = False


def on_signal(signum, _frame):
    global shutdown
    print(f"\nINFO: signal {signum}, stopping after the current poll")
    shutdown = True


def command_for(issue_number: int) -> Optional[list]:
    """The workflow command a new operator comment asks for, or None."""
    comments = gh.comments(issue_number)
    if not comments:
        return None
    latest = comments[-1]
    if seen.get(issue_number) == latest["id"]:
        return None
    seen[issue_number] = latest["id"]
    # Comments from before the trigger started are history, not commands. By time, not
    # by "first seen": an issue's first comment, or a new issue's, is a command too.
    if latest.get("createdAt", "") < STARTED:
        return None
    body = (latest.get("body") or "").strip()
    if gh.MARKER in body or latest.get("author", {}).get("login") != OPERATOR:
        return None
    first, _, rest = body.partition("\n")
    words = first.strip().lower().split()
    if words == ["adw"]:
        run = latest_run(str(issue_number))
        state = ADWState.load(run) if run else None
        resume = run if state and state.get("stage") == "needs-info" else None
        return ["adw_sdlc_iso.py", str(issue_number)] + ([resume] if resume else [])
    if words == ["adw", "patch"] and rest.strip():
        run = latest_run(str(issue_number))
        if not run:
            print(f"INFO: #{issue_number}: `adw patch` but no earlier ADW run for this issue")
            return None
        return ["adw_patch_iso.py", str(issue_number), run, rest.strip()]
    return None


def poll():
    # A failed GitHub call skips this poll (or this issue) and says so; it never stops the trigger.
    try:
        numbers = gh.open_issues()
    except RuntimeError as e:
        print(f"WARNING: can't list the open issues ({e}); trying again in {POLL_SECONDS}s")
        return
    for number in numbers:
        if shutdown:
            return
        try:
            cmd = command_for(number)
        except (RuntimeError, ValueError, KeyError) as e:
            print(f"WARNING: #{number}: can't read its comments ({e}); trying again next poll")
            continue
        if not cmd:
            continue
        print(f"INFO: #{number}: running {' '.join(cmd[:3])}")
        # Not captured: the run's progress streams live into this terminal
        result = subprocess.run(["uv", "run", str(ADWS / cmd[0]), *cmd[1:]], cwd=str(ADWS.parent))
        print(f"INFO: #{number}: {cmd[0]} exited {result.returncode}")


def main():
    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)
    print(f"INFO: watching {REPO_PATH} every {POLL_SECONDS}s for `adw` / `adw patch` comments by @{OPERATOR}")
    poll()
    schedule.every(POLL_SECONDS).seconds.do(poll)
    while not shutdown:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()
