"""Evidence that every hook fires: crafted tool calls in, exit codes and reasons out.

Run: python3 -X utf8 .claude/hooks/test_hooks.py      (exit 0 when every case passes)

guard.py runs against a throwaway repo that has what the rules need: a bare
origin, a committed migration and test file, a factory worktree
(.worktrees/<job>) with an intake.md, an ADW worktree (trees/<id>) with its
own, and a folder named trees/ that is NOT a worktree. format_on_edit.py runs
in this repo on a temporary file. No model is called.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ok = fail = 0


def check(name, cond, detail=""):
    global ok, fail
    ok += bool(cond)
    fail += not cond
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"\n     {detail}"))


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def hook(script, event, cwd):
    res = subprocess.run([sys.executable, "-X", "utf8", str(script)], input=json.dumps(event),
                         capture_output=True, text=True, cwd=cwd,
                         env=dict(os.environ, CLAUDE_PROJECT_DIR=str(cwd)))
    return res.returncode, res.stderr.strip()


# ---- the wiring ----------------------------------------------------------------
settings = json.loads((REPO / ".claude/settings.json").read_text(encoding="utf-8"))
commands = [h["command"] for group in settings["hooks"].values() for m in group for h in m["hooks"]]
check("hooks are wired without `|| true` (exit 2 must reach Claude Code)", all("|| true" not in c for c in commands),
      commands)
pre = settings["hooks"]["PreToolUse"][0]["matcher"].split("|")
check("guard runs before Bash, PowerShell, Read, Edit, Write, Grep, Glob",
      {"Bash", "PowerShell", "Read", "Edit", "Write", "Grep", "Glob"} <= set(pre), pre)
check("settings deny gh pr merge", "Bash(gh pr merge:*)" in settings["permissions"]["deny"])

# ---- a throwaway repo with real git state ----------------------------------------------
box = Path(tempfile.mkdtemp(prefix="guard-test-"))
origin, main = box / "origin.git", box / "repo"
subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
subprocess.run(["git", "clone", "-q", str(origin), str(main)], check=True, capture_output=True)
for rel in [".claude/hooks/guard.py", "factory/config.json"]:
    (main / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(REPO / rel, main / rel)
(main / "db/migrations").mkdir(parents=True)
(main / "db/migrations/0001_init.sql").write_text("create table t (id int);\n")
(main / "apps/api/src").mkdir(parents=True)
(main / "apps/api/src/a.spec.ts").write_text("test('a', () => {});\n")
(main / "REVIEW.md").write_text("# review\n")
(main / "factory/checks.sh").write_text("#!/usr/bin/env bash\n")
git(main, "add", "-A")
git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
git(main, "push", "-q", "origin", "main")
git(main, "worktree", "add", "-q", "-b", "factory/001-x", str(main / ".worktrees/001-x"), "origin/main")
git(main, "worktree", "add", "-q", "-b", "adw/abc123-x", str(main / "trees/abc123"), "origin/main")
(main / "factory/jobs/001-x").mkdir(parents=True)
(main / "agents/abc123").mkdir(parents=True)
(main / "apps/web/src/trees").mkdir(parents=True)  # a component folder named trees: not a worktree
GUARD = main / ".claude/hooks/guard.py"
M, FW, AW = main.as_posix(), (main / ".worktrees/001-x").as_posix(), (main / "trees/abc123").as_posix()


def guard(tool, cwd=M, **inp):
    return hook(GUARD, {"tool_name": tool, "tool_input": inp, "cwd": cwd}, main)


def expect(name, want_block, tool, cwd=M, **inp):
    code, err = guard(tool, cwd, **inp)
    got = "block" if code == 2 else "allow" if code == 0 else f"error {code}"
    check(f"{'blocks' if want_block else 'allows'}: {name}", got == ("block" if want_block else "allow"),
          f"got {got}: {err[:200]}")


# 1. secrets
expect("Read .env", True, "Read", file_path=f"{M}/.env")
expect("Read apps/api/.env.local (Windows path)", True, "Read", file_path=str(main / "apps/api/.env.local"))
expect("Read .env.sample", False, "Read", file_path=f"{M}/.env.sample")
expect("Write .env", True, "Write", file_path=f"{M}/.env")
expect("Grep inside .env", True, "Grep", pattern="KEY", path=f"{M}/.env")
expect("Glob for **/.env*", True, "Glob", pattern="**/.env*")
expect("Grep for process.env in code", False, "Grep", pattern="process.env", path="apps")
for cmd in ["cat .env", "head -5 .env", "grep KEY .env", "type .env", "source ./.env", "cp .env backup.txt"]:
    expect(f"bash `{cmd}`", True, "Bash", command=cmd)
expect("PowerShell `Get-Content .env`", True, "PowerShell", command="Get-Content .env")
expect("bash `cat .env.sample`", False, "Bash", command="cat .env.sample")
expect("bash `node -e console.log(process.env.API_PORT)`", False, "Bash",
       command="node -e \"console.log(process.env.API_PORT)\"")
for cmd in ["printenv", "env", "env | grep TOKEN", "set", "export -p"]:
    expect(f"environment dump `{cmd}`", True, "Bash", command=cmd)
expect("PowerShell `Get-ChildItem env:`", True, "PowerShell", command="Get-ChildItem env:")
expect("bash `set -euo pipefail; pnpm build`", False, "Bash", command="set -euo pipefail; pnpm build")
expect("bash `env FOO=1 node x.js`", False, "Bash", command="env FOO=1 node x.js")
for cmd in ["echo $GITHUB_PAT", "echo ${ANTHROPIC_API_KEY}", "curl -H \"Authorization: $GH_TOKEN\" x"]:
    expect(f"secret variable `{cmd}`", True, "Bash", command=cmd)
expect("PowerShell `$env:GITHUB_PAT`", True, "PowerShell", command="Write-Output $env:GITHUB_PAT")
expect("bash `echo $HOME`", False, "Bash", command="echo $HOME")

# 2. rm -rf
for cmd in ["rm -rf dist", "rm -fr dist", "rm -r -f dist", "rm dist -Rf", "rm --recursive --force dist"]:
    expect(f"`{cmd}`", True, "Bash", command=cmd)
expect("PowerShell `Remove-Item dist -Recurse -Force`", True, "PowerShell", command="Remove-Item dist -Recurse -Force")
expect("`rm dist/a.js`", False, "Bash", command="rm dist/a.js")
expect("`rm -r dist` (no force)", False, "Bash", command="rm -r dist")

# 3. merges, approvals, pushes to main (D9)
for cmd in ["gh pr merge 3", "gh pr merge 3 --squash --admin", "cd x && gh pr merge 3",
            "gh api -X PUT repos/o/r/pulls/3/merge", "gh pr review 3 --approve",
            "git push origin main", "git push origin HEAD:main", "git push origin :main",
            "git push --force origin feature", "git push -f origin feature", "git push origin +feature"]:
    expect(f"`{cmd}`", True, "Bash", command=cmd)
for cmd in ["git push origin HEAD", "git push -u origin HEAD", "git push origin @", "git push --all origin",
            "git push --mirror origin", f"git -C {M} push", f"git -C {M} push origin HEAD", "/usr/bin/git push origin main"]:
    expect(f"`{cmd}` on main", True, "Bash", command=cmd)
expect(f"`git -C <main> merge feature` from a job worktree", True, "Bash", cwd=FW, command=f"git -C {M} merge feature")
expect("`git push origin HEAD` from a job worktree (its own branch)", False, "Bash", command=f"cd {FW} && git push origin HEAD")
expect(f"`git -C <job worktree> push -u origin HEAD`", False, "Bash", command=f"git -C {FW} push -u origin HEAD")
expect("`git commit -m \"push it\"` on main (not a push)", False, "Bash", command='git commit -m "push it"')
expect("`git push` on main", True, "Bash", command="git push")
expect("`git push origin` on main", True, "Bash", command="git push origin")
expect("`git merge feature` on main", True, "Bash", command="git merge feature")
expect("`git merge --no-ff feature` on main", True, "Bash", command="git merge --no-ff feature")
expect("`git merge-base main HEAD` on main (read-only)", False, "Bash", command="git merge-base main HEAD")
expect("`git merge-tree` on main (read-only)", False, "Bash", command="git merge-tree main feature")
expect("`git push -u origin factory/001-x` from the job worktree", False, "Bash", cwd=FW,
       command="git push -u origin factory/001-x")
expect("`git push` from a job worktree (its own branch)", False, "Bash", command=f"cd {FW} && git push")
expect("`git merge origin/main` in a job worktree", False, "Bash", command=f"cd {FW} && git merge origin/main")
expect("`git pull` on main", False, "Bash", command="git pull")
expect("`gh pr view 3`", False, "Bash", command="gh pr view 3")
expect("`gh pr create --draft`", False, "Bash", command="gh pr create --draft --title t --body b")

# 4. migrations already on the base branch
expect("Edit a migration that is on origin/main", True, "Edit", file_path=f"{M}/db/migrations/0001_init.sql")
expect("Write a new migration", False, "Write", file_path=f"{M}/db/migrations/0002_add.sql")
expect("Edit an on-main migration from a job worktree", True, "Edit", file_path=f"{FW}/db/migrations/0001_init.sql")

# 5. the test lock
expect("L1 feature: edit an existing test", False, "Edit", file_path=f"{M}/apps/api/src/a.spec.ts")
(main / ".claude/task-type").write_text("bug\n")
expect("L1 bug (.claude/task-type): edit an existing test", True, "Edit", file_path=f"{M}/apps/api/src/a.spec.ts")
expect("L1 bug: write a new regression test", False, "Write", file_path=f"{M}/apps/api/src/b.spec.ts")
(main / ".claude/task-type").unlink()
(main / "factory/jobs/001-x/intake.md").write_text("DECISION: ACCEPT\nTYPE: bug\nRISK: low\n\n## Scope\nx\n")
expect("L2 bug (intake.md TYPE): edit an existing test in the job worktree", True, "Edit",
       file_path=f"{FW}/apps/api/src/a.spec.ts")
expect("L2 bug: write a new test in the job worktree", False, "Write", file_path=f"{FW}/apps/api/src/c.spec.ts")
(main / "factory/jobs/001-x/intake.md").write_text("DECISION: ACCEPT\nTYPE: feature\nRISK: low\n\n## Scope\nx\n")
expect("L2 feature: edit an existing test in the job worktree", False, "Edit",
       file_path=f"{FW}/apps/api/src/a.spec.ts")
(main / "agents/abc123/intake.md").write_text("DECISION: ACCEPT\nTYPE: bug\nRISK: low\n\n## Scope\nx\n")
expect("L3 bug (agents/<id>/intake.md): edit an existing test in the ADW worktree", True, "Edit",
       file_path=f"{AW}/apps/api/src/a.spec.ts")

# 6. protected paths, only inside worktrees
for rel in ["factory/checks.sh", "REVIEW.md", ".claude/hooks/guard.py", "factory/config.json"]:
    expect(f"edit {rel} from a job worktree", True, "Edit", file_path=f"{FW}/{rel}")
expect("edit REVIEW.md from an ADW worktree", True, "Edit", file_path=f"{AW}/REVIEW.md")
expect("edit REVIEW.md in the main checkout (Chris's session)", False, "Edit", file_path=f"{M}/REVIEW.md")
expect("edit app code in a job worktree", False, "Edit", file_path=f"{FW}/apps/api/src/x.ts")
expect("a folder named trees/ that is no worktree", False, "Edit", file_path=f"{M}/apps/web/src/trees/Tree.tsx")

# 7. run files only where the contract puts them
for rel in ["round-1/review-spec.md", "round-2/review-verify.md", "round-1/shots/01_page.png", "build.md",
            "decision.md", "spec.md", "plan.md", "intake.md", "scout.md", "issue.md", "agents.json"]:
    expect(f"write agents/<id>/{rel}", False, "Write", file_path=f"{M}/agents/abc123/{rel}")
expect("write factory/jobs/<id>/round-3/review-security.md", False, "Write",
       file_path=f"{M}/factory/jobs/001-x/round-3/review-security.md")
for rel in ["review-spec.md", "round1/review-spec.md", "round-1/review-spek.md", "round-1/checks.md",
            "adw_state.json", "notes.md"]:
    expect(f"write agents/<id>/{rel} (not a contract path)", True, "Write", file_path=f"{M}/agents/abc123/{rel}")
expect("edit factory/jobs/<id>/job.json (the scripts' file)", True, "Edit", file_path=f"{M}/factory/jobs/001-x/job.json")
expect("write a review with a relative path beside its round folder", True, "Write",
       file_path="agents/abc123/review-bugs.md")
expect("write review-spec.md at the worktree's root", True, "Write", file_path=f"{AW}/review-spec.md")
expect("write build.md in the main checkout's root", True, "Write", file_path=f"{M}/build.md")
for rel in [".claude/agents/intake.md", ".claude/commands/spec.md", "docs/templates/plan.md"]:
    expect(f"edit {rel} (same name, not a run file)", False, "Edit", file_path=f"{M}/{rel}")
expect("write app code in the ADW worktree", False, "Write", file_path=f"{AW}/apps/web/src/theme.ts")

# 8. the shared dev Postgres
for cmd in ["pnpm db:down", f"cd {AW} && pnpm db:down", "npm run db:down", "docker compose down",
            "docker compose down -v", "docker-compose stop db", "docker compose -f docker-compose.yml rm -f db",
            "docker compose restart", "docker stop levelpath-demo-db-1", "docker ps -q | xargs docker stop",
            "docker container rm -f levelpath-demo-db-1", "docker volume rm levelpath-demo_pgdata",
            "docker volume prune -f", "docker system prune -a"]:
    expect(f"`{cmd}`", True, "Bash", command=cmd)
expect("PowerShell `docker compose down`", True, "PowerShell", command="docker compose down")
for cmd in ["pnpm db:up", f"cd {AW} && pnpm db:up", "docker compose up -d --wait --no-recreate db", "docker ps -a",
            "docker compose ps", "docker compose logs db", "docker volume ls", "docker exec levelpath-demo-db-1 pg_isready",
            "git rm --cached old.txt", "echo docker is down", "cat docker-compose.yml",
            "git add docker-compose.yml && git commit -m \"docker-compose.yml: agents can't stop it\""]:
    expect(f"`{cmd}`", False, "Bash", command=cmd)

subprocess.run(["git", "worktree", "remove", "--force", FW], cwd=main, capture_output=True)
subprocess.run(["git", "worktree", "remove", "--force", AW], cwd=main, capture_output=True)
shutil.rmtree(box, ignore_errors=True)

# ---- format_on_edit.py, in this repo ------------------------------------------------
FMT = HERE / "format_on_edit.py"
tmp = REPO / "apps/api/src/__format_on_edit_check.ts"
try:
    tmp.write_text("export   const  answer=42\n", encoding="utf-8")
    code, err = hook(FMT, {"tool_name": "Write", "tool_input": {"file_path": str(tmp)}, "cwd": str(REPO)}, REPO)
    check("format_on_edit formats the edited file (Prettier)", code == 0 and
          tmp.read_text(encoding="utf-8") == "export const answer = 42;\n", f"exit {code}: {err[:200]} / "
          f"{tmp.read_text(encoding='utf-8')!r}")
    tmp.write_text("export const answer = 42;\nconst unused: any = 1;\n", encoding="utf-8")
    code, err = hook(FMT, {"tool_name": "Edit", "tool_input": {"file_path": str(tmp)}, "cwd": str(REPO)}, REPO)
    check("format_on_edit reports ESLint errors it can't fix (exit 2, shown to the agent)",
          code == 2 and "__format_on_edit_check.ts" in err, f"exit {code}: {err[:300]}")
    code, _ = hook(FMT, {"tool_name": "Write", "tool_input": {"file_path": str(REPO / "README.png")},
                         "cwd": str(REPO)}, REPO)
    check("format_on_edit ignores files it doesn't format", code == 0)
finally:
    tmp.unlink(missing_ok=True)

# ---- graph_first.py, in a throwaway main checkout --------------------------------------
GF = HERE / "graph_first.py"
gbox = Path(tempfile.mkdtemp(prefix="graph-first-"))
G = gbox.as_posix()


def gf(tool, agent="planner", **inp):
    code, err = hook(GF, {"tool_name": tool, "tool_input": inp, "cwd": G, "session_id": "s1", "agent_type": agent}, gbox)
    return "block" if code == 2 else "allow" if code == 0 else f"error {code}: {err[:200]}"


check("graph_first: without a graph, reading code is allowed",
      gf("Read", file_path=f"{G}/apps/api/src/x.ts") == "allow")


def gf_stdout(tool, key, **inp):
    res = subprocess.run([sys.executable, "-X", "utf8", str(GF)], capture_output=True, text=True, cwd=gbox,
                         input=json.dumps({"tool_name": tool, "tool_input": inp, "cwd": G, "agent_id": key}),
                         env=dict(os.environ, CLAUDE_PROJECT_DIR=G))
    return res.returncode, res.stdout


nokey = f"test-{os.getpid()}"
code, out = gf_stdout("Read", nokey, file_path=f"{G}/apps/api/src/x.ts")
check("graph_first: without a graph, warns once that agents aren't using it",
      code == 0 and "systemMessage" in out and "graphify update" in out, f"exit {code}: {out[:200]}")
code, out = gf_stdout("Read", nokey, file_path=f"{G}/apps/api/src/y.ts")
check("graph_first: the warning isn't repeated for the same agent", code == 0 and out.strip() == "", out[:200])
code, out = gf_stdout("Read", f"{nokey}-docs", file_path=f"{G}/docs/README.md")
check("graph_first: no warning for a call that doesn't read code", code == 0 and out.strip() == "", out[:200])
(Path(tempfile.gettempdir()) / "graph-first-warned" / nokey).unlink(missing_ok=True)
(gbox / "graphify-out").mkdir()
(gbox / "graphify-out/graph.json").write_text("{}")
for name, tool, inp in [("Read apps/…", "Read", {"file_path": f"{G}/apps/api/src/x.ts"}),
                        ("Read a worktree's packages/…", "Read", {"file_path": f"{G}/trees/ab/packages/shared/x.ts"}),
                        ("Grep with no path", "Grep", {"pattern": "submit"}),
                        ("Glob **/*.tsx", "Glob", {"pattern": "**/*.tsx"}),
                        ("bash cat apps/…", "Bash", {"command": "cd x && cat apps/web/src/App.tsx"}),
                        ("bash ls packages/shared/src", "Bash", {"command": "ls packages/shared/src"})]:
    check(f"graph_first: blocks before a query: {name}", gf(tool, **inp) == "block", gf(tool, **inp))
for name, tool, inp in [("Read the job's spec", "Read", {"file_path": f"{G}/agents/j/spec.md"}),
                        ("Read a template", "Read", {"file_path": f"{G}/docs/templates/plan.md"}),
                        ("Glob the job folder", "Glob", {"pattern": "agents/j/*"}),
                        ("bash pnpm install", "Bash", {"command": "pnpm install --frozen-lockfile"}),
                        ("bash git diff", "Bash", {"command": "git diff origin/main...HEAD"})]:
    check(f"graph_first: always allows: {name}", gf(tool, **inp) == "allow", gf(tool, **inp))
check("graph_first: a graphify query is allowed",
      gf("Bash", command=f'cd {G} && graphify query "submit route"') == "allow")
check("graph_first: after the query, reading code is allowed",
      gf("Read", file_path=f"{G}/apps/api/src/x.ts") == "allow")
check("graph_first: the builder in the same session (L1, L2) still has to query",
      gf("Read", agent="builder", file_path=f"{G}/apps/api/src/x.ts") == "block")
log = (gbox / "graphify-out/graph-first.log.jsonl").read_text(encoding="utf-8")
check("graph_first: logs blocks and queries", '"blocked"' in log and '"query"' in log)
shutil.rmtree(gbox, ignore_errors=True)

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
