"""Run ids and loggers for the ADWs.

Each script logs to the console and to agents/<adw_id>/<script>/execution.log,
which the control room shows as the orchestrator's decisions.
"""

import logging
import sys
import uuid
from pathlib import Path

RUNS = Path(__file__).resolve().parents[2] / "agents"


def new_adw_id() -> str:
    return uuid.uuid4().hex[:8]


def setup_logger(adw_id: str, script: str) -> logging.Logger:
    folder = RUNS / adw_id / script
    folder.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(f"adw.{adw_id}")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()
    to_file = logging.FileHandler(folder / "execution.log", encoding="utf-8")
    to_file.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s", "%Y-%m-%d %H:%M:%S"))
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # → and ✓ on a Windows console
    to_console = logging.StreamHandler(sys.stdout)
    to_console.setLevel(logging.INFO)
    to_console.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(to_file)
    logger.addHandler(to_console)
    logger.info(f"ADW {script} · run {adw_id}")
    return logger
