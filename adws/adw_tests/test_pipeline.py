"""Unit tests for the ADW pipeline's own logic. No model, no GitHub, no git writes.

Run: python3 -X utf8 adws/adw_tests/test_pipeline.py   (exit 0 when every case passes)

The gate runs it (factory/checks.sh) when a branch changes the harness.
"""

import json
import logging
import sys
import tempfile
import threading
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import dotenv  # noqa: F401  (the ADW scripts get it from uv; plain python3 may not have it)
except ImportError:
    sys.modules["dotenv"] = types.SimpleNamespace(load_dotenv=lambda *a, **k: None)

from adw_modules import gh, pipeline, worktrees  # noqa: E402
from adw_modules import state as state_mod  # noqa: E402
from adw_modules.state import ADWState  # noqa: E402

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


class ReviewPromptTest(unittest.TestCase):
    """pipeline.review(): the prompt names the exact review file; a missing one gets one retry."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="adw-review-"))
        self.saved = (pipeline.role, pipeline.roles.round_dir)
        pipeline.roles.round_dir = lambda adw_id, n: self.dir / f"round-{n}"
        (self.dir / "round-1").mkdir()
        self.calls = []

    def tearDown(self):
        pipeline.role, pipeline.roles.round_dir = self.saved

    def test_a_misplaced_review_is_retried_at_the_named_path(self):
        target = (self.dir / "round-1" / "review-spec.md").as_posix()

        def fake_role(st, logger, name, prompt, model=None, tag=None):
            self.calls.append((tag, prompt))
            # The first attempt writes beside the round folder, as a real run did
            where = self.dir / "review-spec.md" if len(self.calls) == 1 else Path(target)
            where.write_text("VERDICT: PASS\n", encoding="utf-8")

        pipeline.role = fake_role
        st = state()
        st.update(agents={"reviewers": {"spec": "sonnet"}})
        verdicts = pipeline.review(st, LOG)
        self.assertEqual(verdicts, {"spec": "PASS"})
        self.assertEqual([c[0] for c in self.calls], ["review-spec-r1", "review-spec-r1-retry"])
        self.assertIn(f"Write your review to {target}.", self.calls[0][1])
        self.assertIn(f"{target} is missing", self.calls[1][1])


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


class SaveTest(unittest.TestCase):
    """ADWState.save(): survives a reader holding the file, and parallel reviewers' costs."""

    def setUp(self):
        self.saved_runs = state_mod.RUNS
        state_mod.RUNS = Path(tempfile.mkdtemp(prefix="adw-save-"))

    def tearDown(self):
        state_mod.RUNS = self.saved_runs

    def test_a_reader_with_the_file_open_doesnt_crash_the_save(self):
        # The control room reads adw_state.json every 2 s. On Windows, before the retry,
        # about half of these saves failed with PermissionError.
        st = ADWState("t")
        st.save()
        done = threading.Event()

        def reader():
            while not done.is_set():
                try:
                    st.path.read_text(encoding="utf-8")
                except OSError:
                    pass

        t = threading.Thread(target=reader)
        t.start()
        try:
            for i in range(100):
                st.update(round=i)
                st.save()
        finally:
            done.set()
            t.join()
        self.assertEqual(json.loads(st.path.read_text(encoding="utf-8"))["round"], 99)

    def test_parallel_costs_are_all_kept(self):
        st = ADWState("t")
        keys = [f"review-{k}-r1" for k in range(8)]
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda k: [pipeline.add_cost(st, k, 0.5) for _ in range(20)], keys))
        saved = json.loads(st.path.read_text(encoding="utf-8"))["costs"]
        self.assertEqual(saved, {k: 10.0 for k in keys})


class CrashTest(unittest.TestCase):
    """pipeline.on_crash(): an unexpected error ends the run at needs-human, and says why."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="adw-crash-"))
        self.handed = []
        self.saved = (pipeline.folder, pipeline.hand_over)
        pipeline.folder = lambda s: self.dir

    def tearDown(self):
        pipeline.folder, pipeline.hand_over = self.saved

    def crash(self):
        st = state()
        st.update(stage="review")
        with self.assertRaises(RuntimeError):  # raised again: the script still exits non-zero
            with pipeline.on_crash(st, LOG):
                raise RuntimeError("`gh pr list` failed: connection reset")
        return st

    def test_the_crash_is_handed_over(self):
        pipeline.hand_over = lambda s, l: self.handed.append(s)
        self.crash()
        decision = (self.dir / "decision.md").read_text(encoding="utf-8")
        self.assertTrue(decision.startswith("ESCALATE"))
        self.assertIn("crashed at stage review", decision)
        self.assertIn("connection reset", decision)
        self.assertEqual(len(self.handed), 1)

    def test_github_down_too_still_leaves_the_running_stages(self):
        def hand_over(s, l):
            raise RuntimeError("`gh pr comment` failed")
        pipeline.hand_over = hand_over
        st = self.crash()
        self.assertEqual(st["stage"], "needs-human")

    def test_a_stop_that_parked_the_run_passes_through(self):
        for parked in ("needs-info", "rejected"):
            st = state()
            st.update(stage=parked)
            with self.assertRaises(pipeline.Stop):
                with pipeline.on_crash(st, LOG):
                    raise pipeline.Stop("intake rejected the issue")
            self.assertFalse((self.dir / "decision.md").exists())
            self.assertEqual(st["stage"], parked)

    def test_a_stop_in_a_running_stage_is_handed_over(self):
        # Postgres down: the gate exits 2, the pipeline raises Stop at stage gate
        pipeline.hand_over = lambda s, l: (self.handed.append(s), s.update(stage="needs-human"))
        st = state()
        st.update(stage="gate")
        with self.assertRaises(pipeline.Stop):
            with pipeline.on_crash(st, LOG):
                raise pipeline.Stop("the gate couldn't run: 127.0.0.1:5432 is down, run `pnpm db:up`")
        decision = (self.dir / "decision.md").read_text(encoding="utf-8")
        self.assertTrue(decision.startswith("ESCALATE"))
        self.assertIn("stopped at stage gate", decision)
        self.assertIn("pnpm db:up", decision)
        self.assertEqual(st["stage"], "needs-human")


class TriggerTest(unittest.TestCase):
    """trigger_cron.command_for(): only the operator's new `adw` comments start a run."""

    @classmethod
    def setUpClass(cls):
        sys.modules.setdefault("schedule", types.SimpleNamespace())
        saved = gh.operator
        gh.operator = lambda: "chris"  # read when the trigger module loads: no GitHub call
        try:
            from adw_triggers import trigger_cron
        finally:
            gh.operator = saved
        cls.trigger = trigger_cron

    def setUp(self):
        self.trigger.seen.clear()
        self.trigger.STARTED = "2026-11-27T12:00:00Z"
        self.comments = {}
        self.saved = (gh.comments, self.trigger.latest_run)
        gh.comments = lambda n: self.comments.get(n, [])
        self.trigger.latest_run = lambda n: None

    def tearDown(self):
        gh.comments, self.trigger.latest_run = self.saved

    def comment(self, n, cid, body, at, who="chris"):
        self.comments.setdefault(n, []).append({"id": cid, "body": body, "createdAt": at, "author": {"login": who}})

    def test_the_first_comment_on_an_issue_starts_a_run(self):
        self.assertIsNone(self.trigger.command_for(7))  # no comments yet when the trigger looked
        self.comment(7, "c1", "adw", "2026-11-27T12:05:00Z")
        self.assertEqual(self.trigger.command_for(7), ["adw_sdlc_iso.py", "7"])
        self.assertIsNone(self.trigger.command_for(7))  # once only

    def test_comments_from_before_the_start_are_history(self):
        self.comment(7, "c1", "adw", "2026-11-27T11:59:00Z")
        self.assertIsNone(self.trigger.command_for(7))

    def test_only_the_operator_and_never_the_bot(self):
        self.comment(7, "c1", "adw", "2026-11-27T12:05:00Z", who="someone-else")
        self.assertIsNone(self.trigger.command_for(7))
        self.comment(7, "c2", f"{gh.MARKER} adw", "2026-11-27T12:06:00Z")
        self.assertIsNone(self.trigger.command_for(7))

    def test_a_github_failure_skips_the_poll_instead_of_stopping(self):
        saved = gh.open_issues

        def down():
            raise RuntimeError("`gh issue list` failed: timeout")
        gh.open_issues = down
        try:
            self.trigger.poll()  # must not raise
        finally:
            gh.open_issues = saved


if __name__ == "__main__":
    unittest.main(verbosity=1)
