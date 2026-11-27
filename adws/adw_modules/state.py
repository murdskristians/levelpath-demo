"""The state of one ADW run, in agents/<adw_id>/adw_state.json.

The run's work products (issue.md, intake.md, spec.md, plan.md, build.md,
round-N/...) sit next to it: agents/<adw_id>/ is the run's job folder, the same
contract the factory's jobs use. Only the fields below exist; setting any other
name is a bug and raises.
"""

import copy
import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Optional

RUNS = Path(__file__).resolve().parents[2] / "agents"

FIELDS = {
    "adw_id": None,
    "issue_number": None,
    "title": None,
    "stage": "new",  # new, intake, needs-info, rejected, spec, build, gate, review, approve, needs-human, merged, closed
    "branch_name": None,
    "worktree_path": None,
    "backend_port": None,  # API
    "frontend_port": None,  # web
    "task_type": None,  # intake's TYPE: feature, bug, chore
    "risk": None,
    "surfaces": [],
    "agents": {},  # {"reviewers": {...}, "planner": model, "builder": model}
    "round": 0,
    "round_limit": 3,
    "pr_number": None,
    "costs": {},  # USD per role run, API-equivalent
    "all_adws": [],  # the scripts that worked on this run
}


SAVE_TRIES, SAVE_WAIT = 50, 0.1  # up to 5 s for a reader to let go of adw_state.json


class ADWState:
    # One per process: reviewers run in parallel threads and each records its cost.
    # Hold it around a read-modify-write of a field (pipeline.add_cost).
    lock = threading.RLock()

    def __init__(self, adw_id: str):
        if not adw_id:
            raise ValueError("an ADW run needs an id")
        self.adw_id = adw_id
        self.data = copy.deepcopy(FIELDS)
        self.data["adw_id"] = adw_id

    @property
    def path(self) -> Path:
        return RUNS / self.adw_id / "adw_state.json"

    def get(self, key: str, default: Any = None) -> Any:
        value = self.data.get(key)
        return default if value is None else value

    def update(self, **fields: Any) -> None:
        for key, value in fields.items():
            if key not in FIELDS:
                raise KeyError(f"{key} is not an ADW state field")
            self.data[key] = value

    def append_adw_id(self, script: str) -> None:
        if script not in self.data["all_adws"]:
            self.data["all_adws"].append(script)

    def save(self, step: Optional[str] = None) -> None:
        """Write atomically, so a reader (the control room) never sees half a file.

        On Windows the replace fails while any reader has the file open, and the
        control room reads it every 2 seconds: retry, as factory/bin/job does. The lock
        keeps the parallel reviewers' saves from writing the same temporary file."""
        with ADWState.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
            for attempt in range(SAVE_TRIES):
                try:
                    os.replace(tmp, self.path)
                    return
                except PermissionError:
                    if attempt + 1 == SAVE_TRIES:
                        raise
                    time.sleep(SAVE_WAIT)

    @classmethod
    def load(cls, adw_id: str) -> Optional["ADWState"]:
        path = RUNS / adw_id / "adw_state.json"
        if not path.exists():
            return None
        state = cls(adw_id)
        saved = json.loads(path.read_text(encoding="utf-8"))
        state.data.update({k: v for k, v in saved.items() if k in FIELDS})
        return state
