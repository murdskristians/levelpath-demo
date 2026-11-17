"""GitHub for the ADWs, through the `gh` CLI.

`gh` uses its own login, or GITHUB_PAT when that is set. Every comment the ADWs
post starts with MARKER, so the trigger never mistakes the ADWs' own words for
a command.
"""

import json
import os
import subprocess
from typing import Dict, List, Optional

MARKER = "[ADW-BOT]"


def _env() -> Dict[str, str]:
    env = dict(os.environ)  # gh needs the full environment on Windows (APPDATA, USERPROFILE, ...)
    if os.getenv("GITHUB_PAT"):
        env["GH_TOKEN"] = os.environ["GITHUB_PAT"]
    return env


def repo() -> str:
    """owner/name of the origin remote, from an https or ssh URL."""
    res = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError("no git remote 'origin': the ADWs work on a GitHub repository")
    url = res.stdout.strip()
    for prefix in ("https://github.com/", "git@github.com:", "ssh://git@github.com/"):
        if url.startswith(prefix):
            url = url[len(prefix):]
    return url.removesuffix("/").removesuffix(".git")


def repo_url() -> str:
    return f"https://github.com/{repo()}"


def run(*args: str, in_repo: bool = True) -> str:
    """Run gh and return its stdout; raise with gh's message when it fails."""
    cmd = ["gh", *args] + (["-R", repo()] if in_repo else [])
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", env=_env())
    if res.returncode != 0:
        raise RuntimeError(f"`gh {' '.join(args[:3])}` failed: {res.stderr.strip()}")
    return res.stdout


def operator() -> str:
    """The account the ADWs act as."""
    return run("api", "user", "--jq", ".login", in_repo=False).strip()


def issue(number) -> Dict:
    """An issue with its author and comments, as gh's JSON."""
    data = json.loads(run("issue", "view", str(number), "--json", "number,title,body,author,comments,url,state"))
    data["comments"] = sorted(data.get("comments") or [], key=lambda c: c.get("createdAt", ""))
    return data


def open_issues() -> List[int]:
    return [i["number"] for i in json.loads(run("issue", "list", "--state", "open", "--limit", "200",
                                                "--json", "number"))]


def comments(number) -> List[Dict]:
    return issue(number)["comments"]


def comment_issue(number, text: str) -> None:
    run("issue", "comment", str(number), "--body", text if text.startswith(MARKER) else f"{MARKER} {text}")


def comment_pr(pr, text: str) -> None:
    # The marker gets its own line, so a "### heading" after it still renders
    run("pr", "comment", str(pr), "--body", text if text.startswith(MARKER) else f"{MARKER}\n\n{text}")


def add_label(number, label: str) -> None:
    run("issue", "edit", str(number), "--add-label", label)


def remove_label(number, label: str) -> None:
    try:
        run("issue", "edit", str(number), "--remove-label", label)
    except RuntimeError:
        pass  # the label wasn't there


def pr_for_branch(branch: str) -> Optional[int]:
    prs = json.loads(run("pr", "list", "--head", branch, "--state", "open", "--json", "number"))
    return prs[0]["number"] if prs else None


def pr_state(pr) -> str:
    return json.loads(run("pr", "view", str(pr), "--json", "state"))["state"]


def pr_ready(pr) -> None:
    """Draft → ready for review. A person merges it; nothing here can (D9)."""
    if json.loads(run("pr", "view", str(pr), "--json", "isDraft"))["isDraft"]:
        run("pr", "ready", str(pr))
