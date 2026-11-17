"""The ADW pipeline (L3): the factory's steps, driven headless by Python.

    intake → route → worktree → [scout] → planner → round:
        builder → gate → reviewers (parallel) → CHANGES? next round : approver → you merge

Each step runs a shared role (`.claude/agents/<role>.md`) with
`claude -p --agent <role>`, and reads the file the role wrote into the job
folder `agents/<adw_id>/`. Nothing is parsed out of an agent's prose: the
file's first line (`DECISION:`, `STATUS:`, `VERDICT:`, `READY`) is the answer.
The gate is the factory's (`factory/bin/gate --run`), so the same
`factory/checks.sh` judges every driver. The run always ends with a ready PR
labelled for a human. Nothing here can merge (D9).
"""

import glob
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Optional, Tuple

from adw_modules import gh, roles, shots, worktrees
from adw_modules.agent import run_role
from adw_modules.git_ops import is_clean, is_pushed
from adw_modules.logs import new_adw_id
from adw_modules.state import ADWState

LABELS = roles.CONFIG["labels"]
MAX_ROUNDS = roles.CONFIG["max_rounds"]


class Stop(Exception):
    """The run stops here: it is waiting for a person, or it failed and said why."""


# ---- small helpers ---------------------------------------------------------------


def say(state: ADWState, step: str, message: str) -> None:
    """Post a progress comment on the issue, git-adw style: [ADW-BOT] <adw_id>_<step>: ..."""
    gh.comment_issue(state.get("issue_number"), f"{gh.MARKER} {state.get('adw_id')}_{step}: {message}")


def folder(state: ADWState) -> Path:
    return roles.job_folder(state.get("adw_id"))


def add_cost(state: ADWState, key: str, usd: float) -> None:
    costs = dict(state.get("costs") or {})
    costs[key] = round(costs.get(key, 0.0) + usd, 4)
    state.update(costs=costs)
    state.save()


def role(state: ADWState, logger, name: str, prompt: str, model: Optional[str] = None,
         tag: Optional[str] = None) -> str:
    """Run one role from the main checkout (the roles cd into the worktree
    themselves) and return its one-line reply."""
    tag = tag or name
    logger.info(f"→ {tag}{f' ({model})' if model else ''}")
    res = run_role(name, prompt, cwd=str(roles.REPO), log_file=roles.log_path(state.get("adw_id"), tag),
                   model=model)
    add_cost(state, tag, res.cost_usd)
    logger.info(f"← {tag}: {res.text.splitlines()[0] if res.text else res.subtype} (${res.cost_usd:.2f})")
    if not res.ok:
        logger.error(f"{tag} did not finish: {res.subtype}: {res.text[:300]} (log: {res.log_file})")
    return res.text


# ---- start and plan --------------------------------------------------------------


def start(issue_number: str, adw_id: Optional[str], script: str, logger_factory) -> Tuple[ADWState, object]:
    """Create or load the run's state and job folder."""
    adw_id = adw_id or new_adw_id()
    state = ADWState.load(adw_id) or ADWState(adw_id)
    if state.get("issue_number") and str(state.get("issue_number")) != str(issue_number):
        raise Stop(f"ADW run {adw_id} belongs to issue #{state.get('issue_number')}, not #{issue_number}")
    state.update(adw_id=adw_id, issue_number=str(issue_number))
    state.append_adw_id(script)
    folder(state).mkdir(parents=True, exist_ok=True)
    state.save("start")
    return state, logger_factory(adw_id)


def plan(state: ADWState, logger) -> None:
    """intake → route → worktree → [scout] → planner. Raises Stop when the run waits."""
    adw_id, number = state.get("adw_id"), state.get("issue_number")
    issue = gh.issue(number)
    d = folder(state)
    if (d / "intake.md").exists():  # a NEEDS-INFO answered: keep the old question for intake
        k = len(list(d.glob("intake-*.md"))) + 1
        (d / "intake.md").rename(d / f"intake-{k}.md")
    (d / "issue.md").write_text(roles.write_issue_md(issue, gh.operator()), encoding="utf-8")
    branch = state.get("branch_name") or f"adw/{adw_id}-{roles.slugify(issue['title'])}"
    worktree = state.get("worktree_path") or str(roles.REPO / "trees" / adw_id)
    state.update(title=issue["title"], branch_name=branch, worktree_path=worktree, stage="intake")
    state.save("intake")
    say(state, "ops", f"Starting ADW run `{adw_id}` on branch `{branch}`.")

    role(state, logger, "intake", roles.header(state))
    h = roles.header_fields(d / "intake.md")
    decision = h.get("DECISION")
    if decision not in {"ACCEPT", "NEEDS-INFO", "REJECT"}:
        raise Stop(f"intake.md has no valid DECISION line ({decision!r}); see agents/{adw_id}/logs/intake.jsonl")
    surfaces = [s.strip() for s in h.get("SURFACES", "").split(",") if s.strip() and s.strip() != "none"]
    state.update(task_type=h.get("TYPE", "feature").lower(), risk=h.get("RISK", "medium"), surfaces=surfaces)
    say(state, "intake", f"**{decision}** (type {state.get('task_type')}, risk {state.get('risk')}, "
                         f"surfaces: {', '.join(surfaces) or 'none'})\n\n{roles.body_after_header(d / 'intake.md')}")
    if decision == "NEEDS-INFO":
        state.update(stage="needs-info")
        state.save("needs-info")
        gh.add_label(number, LABELS["needs_info"])
        raise Stop("intake needs information from the author; comment `adw` again once it is answered")
    if decision == "REJECT":
        state.update(stage="rejected")
        state.save("rejected")
        raise Stop("intake rejected the issue")

    reviewers, model = roles.route(state.get("risk"), surfaces)
    state.update(agents={"reviewers": reviewers, "planner": model, "builder": model})
    try:
        worktrees.create(adw_id, branch, roles.BASE)
        api, web = worktrees.ports(adw_id)
    except RuntimeError as e:
        raise Stop(str(e))
    state.update(backend_port=api, frontend_port=web, stage="spec", round_limit=MAX_ROUNDS)
    state.save("route")
    logger.info(f"routed: reviewers {reviewers}; planner and builder {model}; ports API {api}, web {web}")

    if state.get("risk") == "high":
        role(state, logger, "scout", roles.header(state))
    for attempt in range(2):
        role(state, logger, "planner", roles.header(state), model=model,
             tag="planner" if not attempt else "planner-retry")
        if (d / "spec.md").exists() and (d / "plan.md").exists():
            break
    else:
        raise Stop("the planner didn't write spec.md and plan.md")
    title = roles.first_line(d / "spec.md").lstrip("# ").strip()
    say(state, "planner", f"Spec and plan written: **{title}**. Building.")


# ---- rounds -------------------------------------------------------------------------


def build(state: ADWState, logger, reason: str) -> bool:
    """One build round. False when the builder is blocked (the run then escalates)."""
    n = state.get("round", 0) + 1
    state.update(round=n, stage="build")
    state.save("build")
    roles.round_dir(state.get("adw_id"), n).mkdir(parents=True, exist_ok=True)
    d = folder(state)
    prompt = f"{roles.header(state)}\nBuild round {n}. {roles.ports_line(state)}\n{reason}"
    model = state.get("agents", {}).get("builder")
    for attempt in range(2):
        role(state, logger, "builder", prompt, model=model, tag=f"builder-r{n}" + ("-retry" if attempt else ""))
        status = roles.first_line(d / "build.md")
        if status == "STATUS: BLOCKED":
            escalate(state, logger, "The builder is blocked:\n\n" + (roles.section(d / "build.md", "Blocked") or ""))
            return False
        problem = check_ready(state, status)
        if not problem:
            return True
        logger.warning(f"build round {n} isn't ready: {problem}")
        prompt = f"{roles.header(state)}\nBuild round {n}. {roles.ports_line(state)}\n" \
                 f"Your build isn't ready: {problem}. Fix that, then update build.md."
    escalate(state, logger, f"Build round {n} never reached a pushed, clean READY state.")
    return False


def check_ready(state: ADWState, status: Optional[str]) -> Optional[str]:
    """The same checks the factory's `job advance <id> gate` makes."""
    wt, branch = state.get("worktree_path"), state.get("branch_name")
    if status != "STATUS: READY":
        return f"build.md starts with {status!r}, not STATUS: READY"
    if not is_clean(wt):
        return "the worktree has uncommitted changes"
    if not is_pushed(wt, branch):
        return f"{branch} isn't pushed to origin"
    pr = gh.pr_for_branch(branch)
    if not pr:
        return f"there is no open PR from {branch}"
    state.update(pr_number=pr)
    state.save("build ready")
    return None


def gate(state: ADWState, logger) -> bool:
    n = state.get("round")
    state.update(stage="gate")
    state.save("gate")
    rd = roles.round_dir(state.get("adw_id"), n)
    res = subprocess.run([sys.executable, "-X", "utf8", str(roles.REPO / "factory" / "bin" / "gate"),
                          "--run", state.get("worktree_path"), str(rd)],
                         capture_output=True, text=True, encoding="utf-8")
    logger.info(res.stdout.strip() or res.stderr.strip())
    if res.returncode not in (0, 1):
        raise Stop(f"the gate couldn't run: {res.stderr.strip()[-500:]}")
    return res.returncode == 0


def review(state: ADWState, logger) -> Dict[str, str]:
    """Run every routed reviewer in parallel; return {key: PASS | CHANGES | invalid}."""
    n = state.get("round")
    state.update(stage="review")
    state.save("review")
    rd = roles.round_dir(state.get("adw_id"), n)
    reviewers: Dict[str, str] = state.get("agents", {}).get("reviewers", {})

    def one(key: str, model: str) -> None:
        extra = f" {roles.ports_line(state)}" if key == "verify" else ""
        role(state, logger, roles.reviewer_agent(key), f"{roles.header(state)}\nReview round {n}.{extra}",
             model=model, tag=f"review-{key}-r{n}")

    with ThreadPoolExecutor(max_workers=len(reviewers) or 1) as pool:  # WAIT FOR ALL
        list(pool.map(lambda kv: one(*kv), reviewers.items()))
    verdicts = {}
    for key, model in reviewers.items():
        line = roles.first_line(rd / f"review-{key}.md") or ""
        if line not in ("VERDICT: PASS", "VERDICT: CHANGES"):
            one(key, model)  # once more: no file, or no verdict line
            line = roles.first_line(rd / f"review-{key}.md") or ""
        verdicts[key] = line.removeprefix("VERDICT: ") if line.startswith("VERDICT: ") else "invalid"
    logger.info(f"round {n} verdicts: {verdicts}")
    return verdicts


def run_rounds(state: ADWState, logger, reason: str) -> None:
    """build → gate → review, until every reviewer passes or the rounds run out."""
    while True:
        if not build(state, logger, reason):
            return
        n = state.get("round")
        if not gate(state, logger):
            if n >= state.get("round_limit"):
                escalate(state, logger, f"The gate failed in round {n}, the last allowed round. "
                                        f"See round-{n}/checks.md.")
                return
            say(state, "gate", f"Round {n}: the gate failed. The builder gets the log.")
            reason = (f"The gate failed: read round-{n}/checks.md and checks.log, "
                      f"fix it, push, and update build.md.")
            continue
        verdicts = review(state, logger)
        if all(v == "PASS" for v in verdicts.values()):
            approve(state, logger)
            return
        changes = [k for k, v in verdicts.items() if v != "PASS"]
        if n >= state.get("round_limit"):
            escalate(state, logger, f"Review rounds exhausted. Outstanding in round-{n}/: {', '.join(changes)}.")
            return
        say(state, "review", f"Round {n}: changes requested by {', '.join(changes)}. Next round.")
        reason = (f"Round {n} reviews are in round-{n}/. Address every Important finding "
                  f"(VERDICT: CHANGES), push, and update build.md for round {n + 1}.")


# ---- the end: a person decides ------------------------------------------------------------


def approve(state: ADWState, logger) -> None:
    state.update(stage="approve")
    state.save("approve")
    n, d = state.get("round"), folder(state)
    role(state, logger, "approver", f"{roles.header(state)} PR: #{state.get('pr_number')}. Final round: {n}.")
    if roles.first_line(d / "decision.md") not in ("READY", "ESCALATE"):
        escalate(state, logger, "The approver didn't write a READY or ESCALATE decision.")
        return
    hand_over(state, logger)


def escalate(state: ADWState, logger, why: str) -> None:
    """Write decision.md for an escalation the approver didn't make, then hand over."""
    (folder(state) / "decision.md").write_text(f"ESCALATE\n\n## Why\n{why}\n", encoding="utf-8")
    hand_over(state, logger)


def hand_over(state: ADWState, logger) -> None:
    """PR ready, decision and evidence posted, issue labelled. Chris merges, or not."""
    d, n = folder(state), state.get("round", 0)
    verdict, _, rest = (d / "decision.md").read_text(encoding="utf-8").partition("\n")
    title = ("ADW: ready for your review (you merge)" if verdict.strip() == "READY"
             else "ADW: needs a human")
    lines = [f"### {title}", "", rest.strip(), ""]
    rd = roles.round_dir(state.get("adw_id"), n)
    rows = [(p.stem.removeprefix("review-"), roles.first_line(p)) for p in sorted(rd.glob("review-*.md"))]
    if rows or (rd / "checks.md").exists():
        lines += ["#### Round " + str(n), "", "| check | result |", "| --- | --- |"]
        if (rd / "checks.md").exists():
            lines.append(f"| gate | {roles.first_line(rd / 'checks.md')} |")
        lines += [f"| {k} | {v} |" for k, v in rows]
        lines.append("")
    lines += screenshots(state, rd)
    total = sum((state.get("costs") or {}).values())
    lines.append(f"_Run `{state.get('adw_id')}`: {n} round(s), ${total:.2f} API-equivalent. "
                 f"Files: `agents/{state.get('adw_id')}/`._")
    body = "\n".join(lines)
    pr = state.get("pr_number")
    if pr:
        gh.pr_ready(pr)
        gh.comment_pr(pr, body)
        say(state, "ops", f"Done: PR #{pr} is ready for your review. You merge it.")
    else:
        say(state, "ops", "no PR to hand over.\n\n" + body)  # the body's heading on its own line
    gh.add_label(state.get("issue_number"), LABELS["needs_human"])
    state.update(stage="needs-human")
    state.save("needs-human")
    logger.info(f"needs-human: {title}")


def screenshots(state: ADWState, rd: Path) -> list:
    found = sorted(glob.glob(str(rd / "shots" / "*.png")))
    if not found:
        return []
    try:
        import logging
        urls = shots.upload(found, state.get("adw_id"), gh.repo().split("/")[0],
                            logging.getLogger(f"adw.{state.get('adw_id')}"))
    except Exception as e:  # screenshots are evidence, not a reason to fail the hand-over
        print(f"screenshot upload failed: {e}", file=sys.stderr)
        urls = {}
    out = ["#### Screenshots", ""]
    for local in found:
        url, name = urls.get(local, local), Path(local).name
        out.append(f"![{name}]({url})" if url.startswith("http") else f"- `{name}` (local: `{local}`)")
    return out + [""]


# ---- entry points the phase scripts call -----------------------------------------------


def sdlc(state: ADWState, logger) -> None:
    plan(state, logger)
    run_rounds(state, logger, "This is round 1: implement spec.md following plan.md.")


def patch(state: ADWState, logger, feedback: str) -> None:
    """Your feedback on a run that is waiting for you: another set of rounds."""
    d = folder(state)
    k = len(list(d.glob("feedback-*.md"))) + 1
    (d / f"feedback-{k}.md").write_text(f"# Feedback {k}\n\nFrom @{gh.operator()} on the issue.\n\n"
                                        f"{feedback.strip()}\n", encoding="utf-8")
    state.update(round_limit=state.get("round", 0) + MAX_ROUNDS)
    state.save("patch")
    say(state, "patch", f"Feedback saved as feedback-{k}.md. Building another round.")
    run_rounds(state, logger, f"The user gave feedback: read feedback-{k}.md and address it, "
                              f"push, and update build.md.")


def latest_run(issue_number: str) -> Optional[str]:
    """The newest ADW id that worked on this issue, for patch runs and NEEDS-INFO resumes."""
    runs = []
    for path in glob.glob(str(roles.REPO / "agents" / "*" / "adw_state.json")):
        st = ADWState.load(Path(path).parent.name)
        if st and str(st.get("issue_number")) == str(issue_number):
            runs.append((os.path.getmtime(path), st.get("adw_id")))
    return max(runs)[1] if runs else None
