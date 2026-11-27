#!/usr/bin/env -S python3 -X utf8
"""PreToolUse guard for every session in this repo.

It runs before each tool call: in your interactive sessions, in the factory's
subagents and in the ADWs' headless `claude -p` agents. It blocks a call by
exiting 2, and the reason it prints on stderr is shown to the agent. It runs
even under --dangerously-skip-permissions (spike, docs/plans/phase-1-audit.md
R2.6).

It blocks:
  1. secrets: any tool or shell command that touches a .env file (samples
     are fine), dumps the environment, or expands a secret-named variable
  2. rm -rf, and PowerShell's Remove-Item -Recurse -Force
  3. merges and approvals (D9: only Chris merges): gh pr merge, gh api .../merge,
     gh pr review --approve, a push or force-push to main, git merge on main
  4. edits to a migration that is already on the base branch (db/migrations/)
  5. the test lock: in a bug task, edits to test files that exist on the base
     branch (new regression tests are fine)
  6. edits to the harness's protected paths from inside an agent's worktree
  7. a run file written where nothing reads it: in a job folder only the contract's
     files (a review only in its round folder), and those names nowhere else

Stdlib only, so it starts fast: one process per tool call.
"""

import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

FILE_TOOLS = {"Read", "Edit", "MultiEdit", "Write", "NotebookEdit"}
EDIT_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
SHELL_TOOLS = {"Bash", "PowerShell"}
BASE_BRANCHES = {"main", "master"}
TEST_FILE = re.compile(r"(\.(spec|test)\.[cm]?[jt]sx?$)|(^|/)(__tests__|tests?)/")
MIGRATIONS = "db/migrations/"


def block(reason):
    print(f"BLOCKED by .claude/hooks/guard.py: {reason}", file=sys.stderr)
    sys.exit(2)


# ---- paths -----------------------------------------------------------------


def norm(path):
    """Forward slashes, Git Bash /c/... as C:/..., for comparing paths on any OS."""
    p = str(path).replace("\\", "/")
    m = re.match(r"^/([a-zA-Z])/(.*)", p)
    if m and os.name == "nt":
        p = f"{m.group(1).upper()}:/{m.group(2)}"
    return p


def locate(path, cwd):
    """(main checkout, checkout root, path relative to that root, run kind, run id).

    run kind is "factory" for .worktrees/<job>/..., "adw" for trees/<adw_id>/...,
    and None for the main checkout."""
    p = norm(path)
    if not re.match(r"^([a-zA-Z]:)?/", p):
        p = norm(Path(cwd) / p)
    for kind, marker in (("factory", "/.worktrees/"), ("adw", "/trees/")):
        if marker in p:
            main, rest = p.split(marker, 1)
            run_id, _, rel = rest.partition("/")
            # Only a real worktree (it has a .git file), not any folder named trees/
            if (Path(main) / ".git").is_dir() and (Path(f"{main}{marker}{run_id}") / ".git").exists():
                return main, f"{main}{marker}{run_id}", rel, kind, run_id
    root = git_out(Path(p).parent if not Path(p).is_dir() else p, "rev-parse", "--show-toplevel")
    root = norm(root) if root else norm(os.environ.get("CLAUDE_PROJECT_DIR", cwd))
    rel = p[len(root):].lstrip("/") if p.lower().startswith(root.lower()) else p
    return root, root, rel, None, None


def git_out(cwd, *args):
    d = Path(cwd)
    while not d.exists() and d != d.parent:
        d = d.parent
    try:
        res = subprocess.run(["git", "-C", str(d), *args], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return res.stdout.strip() if res.returncode == 0 else ""


def exists_at(root, ref, rel):
    try:
        res = subprocess.run(["git", "-C", root, "cat-file", "-e", f"{ref}:{rel}"],
                             capture_output=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return res.returncode == 0


def task_type(main, kind, run_id):
    if kind == "factory":
        source = Path(main) / "factory" / "jobs" / run_id / "intake.md"
    elif kind == "adw":
        source = Path(main) / "agents" / run_id / "intake.md"
    else:
        source = Path(main) / ".claude" / "task-type"
        return source.read_text(encoding="utf-8").strip().lower() if source.exists() else "feature"
    if source.exists():
        m = re.search(r"^TYPE:\s*(\w+)", source.read_text(encoding="utf-8"), re.M)
        if m:
            return m.group(1).lower()
    return "feature"


def config(main):
    try:
        return json.loads((Path(main) / "factory" / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


# ---- 1. secrets --------------------------------------------------------------

ENV_FILE = re.compile(r"(?<![\w$.-])\.env(?![\w-])((?:\.[\w-]+)*)")
SECRET_VAR = re.compile(
    r"(\$\{?|\$env:|%)(?=[A-Za-z_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|_PAT)\b)[A-Za-z_][A-Za-z0-9_]*", re.I)
ENV_DUMP = [
    re.compile(r"(^|[;&|(]\s*)printenv\b"),
    re.compile(r"(^|[;&|(]\s*)env\s*($|[;&|>])"),
    re.compile(r"(^|[;&|(]\s*)set\s*($|[;&|>])"),
    re.compile(r"(^|[;&|(]\s*)export\s+-p\b"),
    re.compile(r"\b(Get-ChildItem|gci|dir|ls|Get-Item|gi)\s+env:", re.I),
    re.compile(r"\[Environment\]::GetEnvironmentVariables", re.I),
]


def is_env_file(text):
    for m in ENV_FILE.finditer(text):
        suffix = m.group(1)
        if not suffix or suffix.split(".")[-1] not in {"sample", "example"}:
            return True
    return False


def check_secrets(tool, inp):
    if tool in FILE_TOOLS:
        name = Path(norm(inp.get("file_path") or inp.get("notebook_path") or "")).name
        if is_env_file(f" {name}"):
            block(f"{name} holds secrets and is off limits to agents. Use .env.sample, "
                  "or ask Chris to look at it.")
    elif tool in {"Grep", "Glob"}:
        target = " ".join(str(inp.get(k, "")) for k in ("path", "glob", "pattern"))
        if is_env_file(" " + norm(target).replace("/", " /")):
            block("searching .env files is off limits: they hold secrets.")
    elif tool in SHELL_TOOLS:
        cmd = inp.get("command", "")
        if is_env_file(cmd):
            block("this command touches a .env file, which holds secrets. Use .env.sample, "
                  "or ask Chris to run it.")
        if any(p.search(cmd) for p in ENV_DUMP):
            block("dumping the environment would print secrets. Print one named, "
                  "non-secret variable instead.")
        m = SECRET_VAR.search(cmd)
        if m:
            block(f"this command expands {m.group(0)}, which looks like a secret. "
                  "Tools that need it read it from the environment themselves.")


# ---- 2. rm -rf ---------------------------------------------------------------

RM_RF = [
    re.compile(r"\brm\s+(\S+\s+)*-[a-z]*r[a-z]*f", re.I),
    re.compile(r"\brm\s+(\S+\s+)*-[a-z]*f[a-z]*r", re.I),
    re.compile(r"\brm\s+(\S+\s+)*--recursive\b.*--force\b"),
    re.compile(r"\brm\s+(\S+\s+)*--force\b.*--recursive\b"),
    re.compile(r"\brm\s+(\S+\s+)*-r\s+(\S+\s+)*-f\b"),
    re.compile(r"\brm\s+(\S+\s+)*-f\s+(\S+\s+)*-r\b"),
]
PS_RM = re.compile(r"\b(Remove-Item|rm|del|ri|rd|rmdir)\b(?=.*\s-Recurse\b)(?=.*\s-Force\b)", re.I)


def check_rm(tool, inp):
    if tool in SHELL_TOOLS:
        cmd = " ".join(inp.get("command", "").split())
        if any(p.search(cmd) for p in RM_RF) or PS_RM.search(cmd):
            block("recursive force delete (rm -rf) is not allowed. Delete specific files, "
                  "or ask Chris.")


# ---- 3. merges, approvals, pushes to main (D9) -------------------------------------

CD_PREFIX = re.compile(r"^\s*cd\s+(\"[^\"]+\"|'[^']+'|\S+)\s*&&")


def command_dir(cmd, cwd):
    m = CD_PREFIX.match(cmd)
    return m.group(1).strip("\"'") if m else cwd


def segments(cmd):
    return [s.strip() for s in re.split(r"&&|\|\||;|\|", cmd) if s.strip()]


def git_command(seg):
    """(directory from -C or None, subcommand, its arguments) for `git [options] <sub> …`,
    else None. Options before the subcommand don't hide it: `git -C <dir> push`."""
    words = seg.split()
    for g, word in enumerate(words):
        if word.strip("\"'").replace("\\", "/").rsplit("/", 1)[-1].lower() not in {"git", "git.exe"}:
            continue
        i, where = g + 1, None
        while i < len(words) and words[i].startswith("-"):
            if words[i] in ("-C", "-c") and i + 1 < len(words):
                if words[i] == "-C":
                    where = words[i + 1].strip("\"'")
                i += 2
            else:
                i += 1
        if i < len(words):
            return where, words[i], words[i + 1:]
    return None


def check_merge(tool, inp, cwd):
    if tool not in SHELL_TOOLS:
        return
    cmd = inp.get("command", "")
    where = command_dir(cmd, cwd)
    for seg in segments(cmd):
        if re.search(r"\bgh\s+pr\s+merge\b", seg):
            block("agents never merge PRs (D9). Chris reviews and merges every PR on GitHub.")
        if re.search(r"\bgh\s+api\b", seg) and re.search(r"/merges?\b", seg):
            block("merging through the GitHub API is a merge too (D9). Chris merges.")
        if re.search(r"\bgh\s+pr\s+review\b", seg) and re.search(r"(\s--approve\b|\s-a\b)", seg):
            block("agents never approve PRs (D9): an agent can't approve its own work.")
        git = git_command(seg)
        if not git:
            continue
        sub_dir, sub, args = git
        here = os.path.join(where, sub_dir) if sub_dir else where
        if sub == "push":
            # GitHub doesn't stop this: branch protection exempts admins, and the agents act as Chris.
            if re.search(r"\s(--force|-f|--force-with-lease)(=\S+)?(\s|$)", seg) or re.search(r"\s\+\S+", seg):
                block("force-pushing is not allowed.")
            if {"--all", "--mirror"} & set(args):
                block("pushing every branch would push main too (D9). Push your own branch.")
            current = git_out(here, "rev-parse", "--abbrev-ref", "HEAD")
            refs = [a for a in args if not a.startswith("-")]
            targets = {r.split(":")[-1].replace("refs/heads/", "") for r in refs[1:]}
            targets = {current if t in {"HEAD", "@", ""} else t for t in targets}  # HEAD is the current branch
            if targets & BASE_BRANCHES:
                block("pushing to main is not allowed (D9). Push your own branch; Chris merges the PR.")
            if not refs[1:] and current in BASE_BRANCHES:
                block("this would push main (the current branch). Push a job branch instead.")
        # `git merge` itself, not `git merge-base` or `git merge-tree` (read-only)
        if sub == "merge" and "--abort" not in args:
            if git_out(here, "rev-parse", "--abbrev-ref", "HEAD") in BASE_BRANCHES:
                block("merging into main is not allowed (D9). Merges happen on GitHub, by Chris.")


# ---- 4-6. migrations, the test lock, protected paths -------------------------------


def check_edits(tool, inp, cwd):
    if tool not in EDIT_TOOLS:
        return
    path = inp.get("file_path") or inp.get("notebook_path")
    if not path:
        return
    main, root, rel, kind, run_id = locate(path, cwd)
    base = f"origin/{config(main).get('base_branch', 'main')}"
    # "Already applied" and "existing test" both mean: already on the base branch.
    # A job may still edit the migration or test it added itself.
    ref = base if git_out(root, "rev-parse", "--verify", "--quiet", base) else "HEAD"

    if rel.startswith(MIGRATIONS) and exists_at(root, ref, rel):
        block(f"{rel} is a migration that is already on {ref}. Applied migrations are "
              "never edited: add a new migration instead.")

    if TEST_FILE.search(rel) and task_type(main, kind, run_id) == "bug":
        if exists_at(root, ref, rel):
            block(f"test lock: this is a bug fix, and {rel} already exists on {ref}. Fix the "
                  "code, not the test; add a new regression test file if you need one.")

    if kind:
        for pattern in config(main).get("protected_paths", []):
            if fnmatch.fnmatch(rel, pattern):
                block(f"{rel} is a protected harness file ({pattern} in factory/config.json). "
                      "Agents can't change it from a worktree; write STATUS: BLOCKED instead.")


# ---- 7. run files only where the run contract puts them ------------------------------

# The files a role writes into a job folder (agents/<id>/ or factory/jobs/<id>/), by path
# inside it. Everything else there is written by the scripts (issue.md and agents.json come
# from /spec in L1), and a file anywhere else is never read: a review written beside its round folder
# instead of in it once cost a run a whole extra round.
RUN_FILE = re.compile(r"^((issue|intake|scout|spec|plan|build|decision)\.md|agents\.json"
                      r"|round-\d+/review-(verify|bugs|spec|security)\.md"
                      r"|round-\d+/shots/[^/]+\.png)$")
RUN_FILE_NAME = re.compile(r"^(intake|scout|spec|plan|build|decision|review-(verify|bugs|spec|security))\.md$")
JOB_FOLDER = re.compile(r"^(.+?)/(agents|factory/jobs)/([^/]+)/(.+)$")
SAME_NAME_ELSEWHERE = (".claude/", "docs/templates/")  # the roles, commands and templates


def check_run_files(tool, inp, cwd):
    if tool not in EDIT_TOOLS:
        return
    path = inp.get("file_path") or inp.get("notebook_path")
    if not path:
        return
    p = norm(path)
    if not re.match(r"^([a-zA-Z]:)?/", p):
        p = norm(Path(cwd) / p)
    m = JOB_FOLDER.match(p)
    if m and (Path(m.group(1)) / ".git").is_dir():  # under the main checkout, not a worktree
        folder, rel = f"{m.group(1)}/{m.group(2)}/{m.group(3)}", m.group(4)
        if not RUN_FILE.match(rel):
            block(f"{rel} is not a file of the run contract in {folder}/. A role writes only its own "
                  "file: intake.md, scout.md, spec.md, plan.md, build.md or decision.md in the job folder, "
                  "and a review as round-<N>/review-<verify|bugs|spec|security>.md in the round folder "
                  "your prompt names. Write it at that exact path.")
        return
    name = p.rsplit("/", 1)[-1]
    if RUN_FILE_NAME.match(name) and not any(f"/{d}" in p for d in SAME_NAME_ELSEWHERE):
        block(f"{name} is a run file, and nothing reads it here ({p}). Write it in the job folder your "
              "prompt names (Job folder: …), reviews in its round-<N>/ folder.")


def main():
    event = json.load(sys.stdin)
    tool = event.get("tool_name", "")
    inp = event.get("tool_input") or {}
    cwd = event.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    check_secrets(tool, inp)
    check_rm(tool, inp)
    check_merge(tool, inp, cwd)
    check_edits(tool, inp, cwd)
    check_run_files(tool, inp, cwd)
    sys.exit(0)


if __name__ == "__main__":
    main()
