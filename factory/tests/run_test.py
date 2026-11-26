"""End-to-end test of the factory scripts in a throwaway repo.

GitHub is faked (the job module's gh() is replaced in-process); git, the
worktree, the gate, checks.sh, locking, ports and cost are all real. It covers
the Windows port (line endings, UTF-8, msvcrt locks, Git Bash, paths, ports)
and the no-merge rule: the factory has no merge command, the approver only
recommends, and a job reaches `merged` only when a person merges its PR.

Run from anywhere:  python3 -X utf8 factory/tests/run_test.py [<sandbox dir>]
Exit 0 when every check passes.
"""
import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SRC = Path(__file__).resolve().parents[2]  # the folder holding factory/
BOX = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="factory-test-"))
ok = fail = 0


def find_bash():
    """Git Bash on Windows (never System32's WSL bash); plain bash elsewhere."""
    if os.name != "nt":
        return "bash"
    exec_path = subprocess.run(["git", "--exec-path"], capture_output=True, text=True).stdout.strip()
    candidate = Path(exec_path).parents[2] / "bin" / "bash.exe"
    if candidate.exists():
        return str(candidate)
    sys.exit("Git Bash not found")


BASH = find_bash()


def check(name, cond, detail=""):
    global ok, fail
    ok += bool(cond)
    fail += not cond
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"\n     {detail}"))


def sh(cmd, cwd, **kw):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, **kw)


# ---- sandbox: bare origin + project checkout with the factory installed ----
if BOX.exists():
    shutil.rmtree(BOX, ignore_errors=True)
BOX.mkdir(parents=True)
origin, proj = BOX / "origin.git", BOX / "project"
sh(["git", "init", "-q", "--bare", "-b", "main", str(origin)], BOX)
sh(["git", "clone", "-q", str(origin), str(proj)], BOX)
for rel in ["factory/bin/job", "factory/bin/gate", "factory/bin/route", "factory/bin/port", "factory/bin/shots",
            "factory/config.json", "factory/.gitattributes"]:
    (proj / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SRC / rel, proj / rel)
# The sandbox has no Postgres: its checks.sh needs no services. Section 5b tests the service check.
config = json.loads((proj / "factory/config.json").read_text(encoding="utf-8"))
config.pop("gate_services", None)
config.pop("pin_risk", None)  # the tests check routing by intake's risk, not an experiment's pin
(proj / "factory/config.json").write_text(json.dumps(config, indent=2), encoding="utf-8", newline="\n")
(proj / "factory/checks.sh").write_text(
    '#!/usr/bin/env bash\nset -euo pipefail\n'
    'echo "checks ok ✓ ünïcode"\n'
    'if [ -f FAIL_CHECKS ]; then echo "lint failed ✗"; exit 1; fi\n', encoding="utf-8", newline="\n")
(proj / ".gitignore").write_text("/factory/jobs/\n/.worktrees/\n")
(proj / "app.txt").write_text("hello\n")
sh(["git", "add", "-A"], proj)
sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], proj)
sh(["git", "push", "-q", "origin", "main"], proj)
check("LF endings kept in copied scripts", b"\r\n" not in (proj / "factory/bin/job").read_bytes())

env = dict(os.environ, CLAUDE_CONFIG_DIR=str(BOX / "claude-config"))

# ---- 1. scripts run by path from Git Bash (shebang -S python3 -X utf8) ----
r = sh([BASH, "-lc", "factory/bin/job --help | head -1; factory/bin/port pid 1; echo rc=$?"], proj, env=env)
check("job runs via shebang in Git Bash", "The only writer" in r.stdout, r.stdout + r.stderr)
check("port runs via shebang", "rc=0" in r.stdout, r.stdout + r.stderr)
r = sh([BASH, "-lc", "factory/bin/job summary"], proj, env=env)
check("job summary with no jobs", r.returncode == 0 and "total $0.00" in r.stdout, r.stdout + r.stderr)
r = sh([BASH, "-lc", "factory/bin/job --help"], proj, env=env)
check("usage lists no merge command", "job merge" not in r.stdout and "never merges" in r.stdout, r.stdout)

# ---- load job in-process with a fake gh ----
loader = importlib.machinery.SourceFileLoader("factory_job", str(proj / "factory/bin/job"))
spec = importlib.util.spec_from_loader("factory_job", loader)
job = importlib.util.module_from_spec(spec)
loader.exec_module(job)
check("job imports without fcntl on Windows", job.WINDOWS is (os.name == "nt"))
check("no merge stage or command in the state machine",
      "merging" not in job.TRANSITIONS and job.TRANSITIONS["approve"] == {"needs-human"}
      and not hasattr(job, "cmd_merge"), job.TRANSITIONS)

ISSUE = {"number": 15, "title": "Add a dark/light théme toggle ☀", "body": "Sun/moon button — saves choice 🌙",
         "author": {"login": "someone"}, "labels": [{"name": "factory"}], "state": "OPEN",
         "url": "https://github.com/o/r/issues/15", "comments": []}
gh_calls, pr_state = [], {"state": "OPEN"}


def fake_gh(*args):
    gh_calls.append(args)
    if args[:2] == ("api", "user"):
        return "someone\n"
    if args[:2] == ("issue", "view"):
        return json.dumps(ISSUE)
    if args[:2] == ("pr", "list"):
        return json.dumps([{"number": 7, "url": "https://github.com/o/r/pull/7"}])
    if args[:2] == ("pr", "view"):
        return json.dumps({"state": pr_state["state"], "isDraft": False})
    return ""


job.gh = fake_gh
_main = job.main


def jmain(argv):
    """Run a job command in-process like a real process: return its exit code,
    then drop its locks the way a process exit would."""
    try:
        _main(argv)
        return 0
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 1
    finally:
        for f in job._locks.values():
            f.close()
        job._locks.clear()


os.chdir(proj)

# ---- 2. create → issue.md with non-ASCII text ----
jmain(["create", "15"])
jid = next(p.name for p in (proj / "factory/jobs").iterdir())
jd = proj / "factory/jobs" / jid
check("create: job id", jid == "001-add-a-dark-light", jid)
check("create: issue.md keeps unicode", "théme toggle ☀" in (jd / "issue.md").read_text(encoding="utf-8"))
wt = json.loads((jd / "job.json").read_text())["worktree"]
check("worktree path uses forward slashes", "\\" not in wt and wt.endswith("/.worktrees/" + jid), wt)

# ---- 3. route via shebang → calls job sync/agents through sys.executable ----
(jd / "intake.md").write_text("DECISION: ACCEPT\nRESCOPED: no\nRISK: low\nSURFACES: ui\n\nGood idea — build it.\n",
                              encoding="utf-8")
r = sh([BASH, "-lc", f"factory/bin/route {jid}"], proj, env=env)
check("route runs and records reviewers (risk picks the models)",
      r.returncode == 0 and "reviewers verify sonnet, bugs sonnet, spec haiku; planner and builder sonnet" in r.stdout,
      r.stdout + r.stderr)
r = sh([BASH, "-lc", f"factory/bin/route --intake 'factory/jobs/{jid}/intake.md'"], proj, env=env)
check("route --intake prints the same agent set for L1",
      r.returncode == 0 and json.loads(r.stdout) == {"risk": "low", "reviewers":{"verify": "sonnet", "bugs": "sonnet", "spec": "haiku"},
                                                    "planner": "sonnet", "builder": "sonnet"}, r.stdout + r.stderr)
agents = json.loads((jd / "job.json").read_text())["agents"]
check("route records planner and builder models", agents.get("planner") == "sonnet" and agents.get("builder") == "sonnet",
      agents)

# ---- 4. advance → spec creates the real worktree from origin/main ----
jmain(["advance", jid, "spec"])
check("advance spec: worktree created", Path(wt).is_dir() and (Path(wt) / "app.txt").exists(), wt)
(jd / "spec.md").write_text("# Spec\n")
jmain(["advance", jid, "build"])

# builder's work in the worktree: commit + push, build.md READY
(Path(wt) / "app.txt").write_text("hello, dark mode 🌙\n", encoding="utf-8")
sh(["git", "add", "-A"], wt)
sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "theme"], wt)
sh(["git", "push", "-q", "-u", "origin", f"factory/{jid}"], wt)
(jd / "build.md").write_text("STATUS: READY\n\nDone.\n")
jmain(["advance", jid, "gate"])
check("advance gate: PR found", json.loads((jd / "job.json").read_text())["pr"] == 7)

# ---- 5. gate via shebang: Git Bash runs checks.sh, unicode output ----
r = sh([BASH, "-lc", f"factory/bin/gate {jid}"], proj, env=env)
checks_md = (jd / "round-1/checks.md").read_text(encoding="utf-8")
check("gate PASS", r.returncode == 0 and "GATE: PASS" in r.stdout, r.stdout + r.stderr)
check("gate log keeps unicode", "checks ok ✓ ünïcode" in checks_md)
r = sh([BASH, "-lc", f"factory/bin/gate {jid} --merge"], proj, env=env)
check("gate has no --merge mode", r.returncode != 0 and not (jd / "round-1/merge-checks.md").exists(),
      r.stdout + r.stderr)

# ---- 5b. gate: the exact tree it judged, and a service that is down ----
head = sh(["git", "rev-parse", "HEAD"], wt).stdout.strip()
r = sh([BASH, "-lc", f"factory/bin/gate --tree '{wt}'"], proj, env=env)
check("gate --tree on a clean worktree is HEAD", r.stdout.strip() == head, r.stdout + r.stderr)
(Path(wt) / "scratch.txt").write_text("uncommitted\n")
r = sh([BASH, "-lc", f"factory/bin/gate --tree '{wt}'"], proj, env=env)
dirty = r.stdout.strip()
check("gate --tree marks uncommitted changes", dirty.startswith(head + "+dirty:"), dirty)
l1_round = BOX / "l1-round"
sh([BASH, "-lc", f"factory/bin/gate --run '{wt}' '{l1_round.as_posix()}'"], proj, env=env)
check("gate --run records the dirty tree as COMMIT",
      f"COMMIT: {dirty}" in (l1_round / "checks.md").read_text(encoding="utf-8"))
(Path(wt) / "scratch.txt").unlink()
config["gate_services"] = [{"tcp": "127.0.0.1:1", "hint": "the test service"}]
(proj / "factory/config.json").write_text(json.dumps(config), encoding="utf-8", newline="\n")
down_round = BOX / "down-round"
r = sh([BASH, "-lc", f"factory/bin/gate --run '{wt}' '{down_round.as_posix()}'"], proj, env=env)
check("a service that is down: exit 2, nothing recorded",
      r.returncode == 2 and "the test service" in r.stderr and not down_round.exists(), r.stdout + r.stderr)
config.pop("gate_services")
(proj / "factory/config.json").write_text(json.dumps(config), encoding="utf-8", newline="\n")

# ---- 6. builder Stop hook, run the way Claude Code runs it, with a Windows-style project dir ----
transcript = BOX / "transcript.jsonl"
transcript.write_text(json.dumps({"message": {"content": f"Job: {jid}. Job folder: x/. Build round 1."}}) + "\n")
event = json.dumps({"stop_hook_active": False, "agent_transcript_path": str(transcript)})
hook_env = dict(env, CLAUDE_PROJECT_DIR=str(proj))  # backslashes, like Claude Code on Windows
hook_cmd = '"$CLAUDE_PROJECT_DIR"/factory/bin/gate --hook'
r = subprocess.run([BASH, "-c", hook_cmd], input=event, capture_output=True, text=True, env=hook_env, cwd=proj)
check("hook passes when checks pass", r.returncode == 0, f"rc={r.returncode} {r.stdout}{r.stderr}")
(Path(wt) / "FAIL_CHECKS").write_text("x")
r = subprocess.run([BASH, "-c", hook_cmd], input=event, capture_output=True, text=True, env=hook_env, cwd=proj)
check("hook blocks (exit 2) when checks fail", r.returncode == 2 and "lint failed ✗" in r.stderr,
      f"rc={r.returncode} {r.stderr[-300:]}")
r = sh([BASH, "-lc", f"factory/bin/gate {jid}"], proj, env=env)
check("gate FAIL on failing checks", r.returncode == 1 and "GATE: FAIL" in r.stdout, r.stdout + r.stderr)
(Path(wt) / "FAIL_CHECKS").unlink()
sh([BASH, "-lc", f"factory/bin/gate {jid}"], proj, env=env)
rd1 = jd / "round-1"
check("re-runs keep the earlier records (checks-1.md PASS, checks-2.md FAIL)",
      (rd1 / "checks-1.md").read_text(encoding="utf-8").startswith("GATE: PASS")
      and (rd1 / "checks-2.md").read_text(encoding="utf-8").startswith("GATE: FAIL")
      and (rd1 / "checks-2.log").exists(), sorted(p.name for p in rd1.iterdir()))
latest = (rd1 / "checks.md").read_text(encoding="utf-8")
check("the latest checks.md passes and names the earlier runs",
      latest.startswith("GATE: PASS") and "checks-2.md (GATE: FAIL)" in latest, latest[:400])

# ---- 7. lock: a second process waits while the first holds the job ----
holder = subprocess.Popen([sys.executable, "-X", "utf8", "-c",
    "import importlib.machinery,importlib.util,sys,time;"
    f"l=importlib.machinery.SourceFileLoader('j',r'{proj / 'factory/bin/job'}');"
    "s=importlib.util.spec_from_loader('j',l);m=importlib.util.module_from_spec(s);l.exec_module(m);"
    f"m.load('{jid}');print('locked',flush=True);time.sleep(4)"], stdout=subprocess.PIPE, text=True)
holder.stdout.readline()
t = time.monotonic()
r = sh([BASH, "-lc", f"factory/bin/job sync {jid}"], proj, env=env)
waited = time.monotonic() - t
holder.wait()
check(f"lock: second process waited for the first ({waited:.1f}s)", waited >= 2.5 and r.returncode == 0,
      r.stdout + r.stderr)

# ---- 8. cost: transcript written with git-style path (c:/..., forward slashes) ----
proj_key = "".join(c if c.isalnum() else "-" for c in str(job.REPO))
sub = BOX / "claude-config/projects" / proj_key / "sess1/subagents"
sub.mkdir(parents=True)
folder = (jd.as_posix()[0].lower() + jd.as_posix()[1:]) + "/"
(sub / "agent-1.jsonl").write_text(
    json.dumps({"message": {"content": f"Job: {jid}. Job folder: {folder}. Main checkout: x."}}) + "\n"
    + json.dumps({"type": "assistant", "message": {"id": "m1", "model": "claude-haiku-5-5",
                  "usage": {"input_tokens": 1_000_000, "output_tokens": 0}}}) + "\n"
    + json.dumps({"type": "user", "message": {"content": "non-cp1252 bytes: \u0081 \u2192 ✓"}}) + "\n",
    encoding="utf-8")
# an agent of an earlier job with the same id (it started before this job did): left out
old = BOX / "claude-config/projects" / proj_key / "sess0/subagents"
old.mkdir(parents=True)
(old / "agent-old.jsonl").write_text(
    json.dumps({"type": "user", "timestamp": "2020-01-01T00:00:00Z",
                "message": {"content": f"Job: {jid}. Job folder: {folder}. Main checkout: x."}}) + "\n"
    + json.dumps({"type": "assistant", "message": {"id": "m0", "model": "claude-haiku-5-5",
                  "usage": {"input_tokens": 5_000_000, "output_tokens": 0}}}) + "\n", encoding="utf-8")
# the orchestrator chat that spawned agent-1: counted from the job's start
from datetime import datetime, timezone  # noqa: E402
(sub.parent.with_suffix(".jsonl")).write_text(
    json.dumps({"type": "user", "message": {"content": "/factory run 15"}}) + "\n"
    + json.dumps({"type": "assistant", "timestamp": "2020-01-01T00:00:00Z",
                  "message": {"id": "o0", "model": "claude-haiku-5-5", "usage": {"input_tokens": 9_000_000}}}) + "\n"
    + json.dumps({"type": "assistant", "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "message": {"id": "o1", "model": "claude-haiku-5-5", "usage": {"input_tokens": 2_000_000}}}) + "\n",
    encoding="utf-8")
r = sh([sys.executable, str(proj / "factory/bin/job"), "summary", jid], proj, env=env)  # no -X utf8
check("cost found from a UTF-8 transcript, even without -X utf8 ($0.10)", "agents $0.10" in r.stdout,
      r.stdout + r.stderr)
check("an earlier attempt's agent is left out, the orchestrator chat counted from the job's start ($0.20)",
      "orchestrator chat $0.20" in r.stdout and "total $0.30" in r.stdout, r.stdout + r.stderr)

# ---- 9. no merge: reviews pass, the approver recommends, the job waits for a person ----
check("advance review", jmain(["advance", jid, "review"]) == 0)
for reviewer in json.loads((jd / "job.json").read_text())["agents"]["reviewers"]:
    (jd / f"round-1/review-{reviewer}.md").write_text("VERDICT: PASS\n\n## Summary\n- fine\n")
leftover = subprocess.Popen([sys.executable, "-m", "http.server", str(5100 + 10 * 1 + 1)], cwd=wt,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
check("advance approve", jmain(["advance", jid, "approve"]) == 0)
try:
    leftover.wait(timeout=10)
except subprocess.TimeoutExpired:
    leftover.kill()
check("leaving review stops a dev server the verifier left on the job's port", leftover.returncode is not None
      and not sh([BASH, "-lc", f"factory/bin/port pid {5100 + 10 * 1 + 1}"], proj, env=env).stdout.strip())
check("approve → merging is illegal", jmain(["advance", jid, "merging"]) != 0)
(jd / "decision.md").write_text("APPROVE\n\n## Summary\n- old verdict\n")
check("an APPROVE verdict is refused (READY or ESCALATE only)", jmain(["advance", jid, "needs-human"]) != 0)
(jd / "decision.md").write_text("READY\n\n## Summary\n- would merge it\n\n## For the human\nLook at app.txt.\n")
(jd / "round-1/shots").mkdir(parents=True, exist_ok=True)
(jd / "round-1/shots/01_page.png").write_bytes(b"\x89PNG fake")
gh_calls.clear()
check("READY → needs-human", jmain(["advance", jid, "needs-human"]) == 0
      and json.loads((jd / "job.json").read_text())["stage"] == "needs-human")
pr_comments = [c for c in gh_calls if c[:2] == ("pr", "comment")]
check("READY posts 'ready for your review' on the PR",
      pr_comments and "ready for your review (you merge)" in pr_comments[0][-1], gh_calls)
check("the hand-over lists the screenshot by a path inside the repo, never this machine's path",
      "#### Screenshots" in pr_comments[0][-1] and "01_page.png" in pr_comments[0][-1]
      and str(BOX).replace("\\", "/") not in pr_comments[0][-1].replace("\\", "/"), pr_comments[0][-1])
check("no gh pr merge was called", not any(c[:2] == ("pr", "merge") for c in gh_calls), gh_calls)
later = job.screenshots_md({"id": jid, "round": 2})  # round 2's verifier took none
check("the hand-over falls back to the latest round with screenshots, and says so",
      "From round 1; the verifier took none in round 2." in later and "01_page.png" in later, later)
r = sh([BASH, "-lc", f"factory/bin/job merge {jid}"], proj, env=env)
check("`job merge` is refused as bad arguments", r.returncode != 0 and "bad arguments" in r.stderr,
      r.stdout + r.stderr)

# ---- 9b. screenshots: uploaded to a public store for a public repo, kept local otherwise ----
loader = importlib.machinery.SourceFileLoader("factory_shots", str(proj / "factory/bin/shots"))
spec = importlib.util.spec_from_loader("factory_shots", loader)
shots = importlib.util.module_from_spec(spec)
loader.exec_module(shots)
png = proj / "page one.png"
png.write_bytes(b"\x89PNG data")
puts = []
repo_info = {"private": False}


def fake_github(method, path, body=None):
    if method == "PUT":
        puts.append((path, body))
        return {}
    if path == "/repos/me/proj":
        return repo_info
    if path == "/user":
        return {"login": "me"}
    if path == "/repos/me/adw-screenshots":
        return {"default_branch": "main"}
    return None  # the file isn't in the store yet


shots.origin = lambda: ("me", "proj")
urls = shots.upload("007-job", [png], fake_github)
check("a public repo's screenshot goes to <you>/adw-screenshots/<project>/<run>/<file>",
      list(urls.values()) == ["https://raw.githubusercontent.com/me/adw-screenshots/main/proj/007-job/page%20one.png"]
      and puts and puts[0][0] == "/repos/me/adw-screenshots/contents/proj/007-job/page%20one.png", (urls, puts))
check("the comment section shows it inline",
      shots.markdown("007-job", [png], fake_github)
      .startswith("#### Screenshots\n\n![page one.png](https://raw.githubusercontent.com/me/"))
puts.clear()
repo_info["private"] = True
check("a private repo's screenshots are never published",
      shots.upload("007-job", [png], fake_github) == {} and not puts, puts)
repo_info["private"] = False


def gh_logged_out(method, path, body=None):
    raise RuntimeError("To get started with GitHub CLI, please run:  gh auth login")


check("gh not logged in: nothing is uploaded, no error", shots.upload("007-job", [png], gh_logged_out) == {})
shots.origin = lambda: (None, "proj")
check("origin not on GitHub: nothing is uploaded", shots.upload("007-job", [png], fake_github) == {})
r = sh([BASH, "-lc", "factory/bin/shots"], proj, env=env)
check("shots without arguments prints usage and exits 2", r.returncode == 2 and "Usage:" in r.stderr, r.stderr)

# ---- 10. a person merges on GitHub: the job's dev server is stopped, then the worktree removed ----
port = 5100 + 10 * 1
server = subprocess.Popen([sys.executable, "-m", "http.server", str(port)], cwd=wt,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
r = sh([BASH, "-lc", f"factory/bin/port pid {port}"], proj, env=env)
# python3 may be a launcher: the listener can be its child process, not server.pid
check("port pid finds the dev server", r.returncode == 0 and r.stdout.split(), r.stdout + r.stderr)
before = json.loads((jd / "job.json").read_text())["stage"]
jmain(["check-merges"])  # the PR is still open: nothing moves
stage = json.loads((jd / "job.json").read_text())["stage"]
check("check-merges leaves a job with an open PR alone", stage == before, f"{before} -> {stage}")
pr_state["state"] = "MERGED"
jmain(["check-merges"])  # what the control room runs every minute
server.wait(timeout=10)
stage = json.loads((jd / "job.json").read_text())["stage"]
check("merged by a person: job stage", stage == "merged", stage)
check("merged: needs-human label removed",
      any(c[:2] == ("issue", "edit") and "--remove-label" in c for c in gh_calls), gh_calls)
check("merged: dev server stopped", server.poll() is not None)
check("merged: worktree removed", not Path(wt).exists(), wt)

os.chdir(BOX)
print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
