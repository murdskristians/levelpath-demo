"""Run one role agent headless: `claude -p --agent <role>`.

The ADWs no longer send slash-command prompts and parse the agent's prose.
They run the same role definitions as the factory (`.claude/agents/<role>.md`)
with the same prompt header, and read the file the role writes into the job
folder (docs/plans/phase-1-audit.md, D8).

Every run is capped: --max-turns and --max-budget-usd stop a runaway agent
(the budget is checked after each turn, so a run can overshoot by one turn).
ANTHROPIC_API_KEY is not passed to the agent unless ADW_USE_API_KEY=true, so
runs use the logged-in Claude subscription (spike: apiKeySource "none").
"""

import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Dict, Optional

from dotenv import load_dotenv

load_dotenv()

# shutil.which resolves the npm shim on Windows (claude.cmd), which subprocess
# cannot find from the bare name "claude"
_claude_name = os.getenv("CLAUDE_CODE_PATH", "claude")
CLAUDE_PATH = shutil.which(_claude_name) or _claude_name

# Per-role caps. Turns are tool-call rounds; budget is API-equivalent USD.
LIMITS: Dict[str, Dict[str, float]] = {
    "intake": {"turns": 30, "usd": 1.0},
    "scout": {"turns": 40, "usd": 0.5},
    "planner": {"turns": 60, "usd": 3.0},
    "builder": {"turns": 200, "usd": 10.0},
    "verifier": {"turns": 80, "usd": 3.0},
    "reviewer-bugs": {"turns": 50, "usd": 2.0},
    "reviewer-spec": {"turns": 50, "usd": 2.0},
    "reviewer-security": {"turns": 50, "usd": 3.0},
    "approver": {"turns": 40, "usd": 2.0},
}
TIMEOUT_SECONDS = 2700  # 45 minutes: a dev server left running must not hang the run
RETRYABLE = {"no_result", "process_error", "timeout"}


@dataclass
class RoleResult:
    """What one role run returned."""

    ok: bool
    text: str  # the agent's final reply: by contract, the first line of its file
    subtype: str = ""  # "success", "error_max_turns", "error_max_budget_usd", ...
    cost_usd: float = 0.0
    session_id: Optional[str] = None
    log_file: str = ""
    extra: Dict = field(default_factory=dict)


def get_claude_env() -> Dict[str, str]:
    """The environment a role agent runs with: only what Claude Code needs."""
    keep = [
        "HOME", "USER", "PATH", "SHELL", "TERM", "LANG",
        # Windows: Node's crypto, gh, git and the shell need these
        "SYSTEMROOT", "SystemDrive", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
        "TEMP", "TMP", "PATHEXT", "COMSPEC", "ProgramFiles", "ProgramFiles(x86)",
        "HOMEDRIVE", "HOMEPATH",
        # agent-browser uses the installed Chrome (Avast breaks its own download)
        "AGENT_BROWSER_EXECUTABLE_PATH",
        "CLAUDE_CODE_PATH", "CLAUDE_CODE_GIT_BASH_PATH",
    ]
    env = {k: os.environ[k] for k in keep if os.environ.get(k)}
    env["CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR"] = "true"
    if os.getenv("ADW_USE_API_KEY", "").lower() in ("1", "true", "yes") and os.getenv("ANTHROPIC_API_KEY"):
        env["ANTHROPIC_API_KEY"] = os.environ["ANTHROPIC_API_KEY"]
    github_pat = os.getenv("GITHUB_PAT")
    if github_pat:
        env["GH_TOKEN"] = github_pat  # gh inside the agent acts with this token
    return env


def _parse(log_file: str) -> Optional[dict]:
    """The first `result` message of a stream-json log (background tasks can
    append later ones)."""
    try:
        with open(log_file, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    msg = json.loads(line)
                    if msg.get("type") == "result":
                        return msg
    except (OSError, ValueError) as e:
        print(f"agent: can't read {log_file}: {e}", file=sys.stderr)
    return None


def run_role_once(role: str, prompt: str, cwd: str, log_file: str,
                  model: Optional[str] = None) -> RoleResult:
    limits = LIMITS.get(role, {"turns": 50, "usd": 2.0})
    cmd = [CLAUDE_PATH, "-p", "--agent", role,
           "--output-format", "stream-json", "--verbose",
           "--dangerously-skip-permissions",  # the guard hook still blocks (spike R2.6)
           "--max-turns", str(int(limits["turns"])),
           "--max-budget-usd", str(limits["usd"])]
    if model:
        cmd += ["--model", model]
    os.makedirs(os.path.dirname(log_file), exist_ok=True)
    try:
        # The prompt goes in on stdin, not as an argument: cmd.exe would read
        # characters like > in it as redirections
        with open(log_file, "w", encoding="utf-8") as out:
            proc = subprocess.run(cmd, stdout=out, stderr=subprocess.PIPE, input=prompt,
                                  text=True, encoding="utf-8", env=get_claude_env(),
                                  timeout=TIMEOUT_SECONDS, cwd=cwd)
    except subprocess.TimeoutExpired:
        return RoleResult(False, f"{role} timed out after {TIMEOUT_SECONDS // 60} minutes",
                          "timeout", log_file=log_file)
    except OSError as e:
        return RoleResult(False, f"couldn't start claude ({CLAUDE_PATH}): {e}", "process_error",
                          log_file=log_file)
    result = _parse(log_file)
    if not result:
        err = (proc.stderr or "").strip()[-500:] or f"exit {proc.returncode}, no result message"
        return RoleResult(False, f"{role} returned no result: {err}", "no_result", log_file=log_file)
    subtype = result.get("subtype", "")
    ok = not result.get("is_error") and subtype == "success"
    text = (result.get("result") or "").strip()
    if not ok and not text:
        text = f"{role} stopped: {subtype or 'error'}"
    return RoleResult(ok, text, subtype, float(result.get("total_cost_usd") or 0.0),
                      result.get("session_id"), log_file)


def run_role(role: str, prompt: str, cwd: str, log_file: str,
             model: Optional[str] = None, retries: int = 1) -> RoleResult:
    """Run a role, retrying once on a crash (not on a cap: that is an answer)."""
    total = 0.0
    for attempt in range(retries + 1):
        if attempt:
            time.sleep(5)
        res = run_role_once(role, prompt, cwd, log_file, model)
        total += res.cost_usd
        if res.ok or res.subtype not in RETRYABLE:
            break
    res.cost_usd = total
    return res
