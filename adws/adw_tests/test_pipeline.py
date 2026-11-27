"""Unit tests for the ADW pipeline's own logic. No model, no GitHub, no git writes.

Run: python3 -X utf8 adws/adw_tests/test_pipeline.py   (exit 0 when every case passes)

The gate runs it (factory/checks.sh) when a branch changes the harness.
"""

import logging
import sys
import tempfile
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import dotenv  # noqa: F401  (the ADW scripts get it from uv; plain python3 may not have it)
except ImportError:
    sys.modules["dotenv"] = types.SimpleNamespace(load_dotenv=lambda *a, **k: None)

from adw_modules import pipeline, worktrees  # noqa: E402

LOG = logging.getLogger("test_pipeline")


class State(dict):
    def update(self, **kw):
        super().update(kw)

    def save(self, *_):
        pass


def state():
    return State(round=1, pr_number=5, adw_id="t", worktree_path="trees/t", branch_name="b", issue_number="1")


class ApproveTest(unittest.TestCase):
    """pipeline.approve(): the approver's file is the answer, with one retry when it's missing."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="adw-approve-"))
        self.calls, self.handed = [], []
        self.saved = (pipeline.folder, pipeline.role, pipeline.hand_over)
        pipeline.folder = lambda s: self.dir
        pipeline.hand_over = lambda s, l: self.handed.append(
            (self.dir / "decision.md").read_text(encoding="utf-8").splitlines()[0])

    def tearDown(self):
        pipeline.folder, pipeline.role, pipeline.hand_over = self.saved

    def run_with(self, writes):
        def fake_role(st, logger, name, prompt, model=None, tag=None):
            self.calls.append((tag, "missing" in prompt))
            first = writes[len(self.calls) - 1]
            if first:
                (self.dir / "decision.md").write_text(f"{first}\n\n## Why\nx\n", encoding="utf-8")
            return "READY"  # the reply is never read

        pipeline.role = fake_role
        pipeline.approve(state(), LOG)

    def test_written_first_time(self):
        self.run_with(["READY"])
        self.assertEqual(self.calls, [("approver", False)])
        self.assertEqual(self.handed, ["READY"])

    def test_written_on_the_retry(self):
        self.run_with([None, "READY"])
        self.assertEqual(self.calls, [("approver", False), ("approver-retry", True)])
        self.assertEqual(self.handed, ["READY"])

    def test_never_written_escalates(self):
        self.run_with([None, None])
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.handed, ["ESCALATE"])

    def test_a_bad_first_line_counts_as_missing(self):
        self.run_with(["Looks good", "ESCALATE"])
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.handed, ["ESCALATE"])


class RemoveTest(unittest.TestCase):
    """worktrees.remove(): retries a delete that Windows refuses for a few seconds."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="adw-remove-"))
        (self.dir / "f.txt").write_text("x", encoding="utf-8")
        self.saved = (worktrees.path_of, worktrees.git, worktrees.rmtree_long, worktrees.REMOVE_WAIT)
        worktrees.path_of = lambda adw_id: self.dir
        worktrees.git = lambda *a, **k: types.SimpleNamespace(returncode=1, stderr="Filename too long")
        worktrees.REMOVE_WAIT = 0

    def tearDown(self):
        worktrees.path_of, worktrees.git, worktrees.rmtree_long, worktrees.REMOVE_WAIT = self.saved
        if self.dir.exists():
            self.saved[2](self.dir)

    def failing(self, times):
        real, tries = self.saved[2], []

        def rmtree(path):
            tries.append(path)
            if len(tries) <= times:
                raise PermissionError(32, "The process cannot access the file")
            real(path)
        worktrees.rmtree_long = rmtree
        return tries

    def test_retries_until_the_folder_goes(self):
        tries = self.failing(2)
        self.assertTrue(worktrees.remove("t"))
        self.assertEqual(len(tries), 3)

    def test_gives_up_and_says_so(self):
        tries = self.failing(99)
        self.assertFalse(worktrees.remove("t"))
        self.assertEqual(len(tries), worktrees.REMOVE_TRIES)


if __name__ == "__main__":
    unittest.main(verbosity=1)
