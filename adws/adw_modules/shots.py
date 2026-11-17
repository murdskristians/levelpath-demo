"""Put a run's screenshots where a GitHub comment can show them.

GitHub doesn't host images posted by the API, so the screenshots go to a public
repository of yours, <owner>/adw-screenshots, under adw/<adw_id>/, through the
contents API. It needs GITHUB_PAT; without it, the hand-over lists the files by
local path instead.
"""

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, Optional

API = "https://api.github.com"
REPO_NAME = "adw-screenshots"


def _call(method: str, url: str, token: str, body: Optional[dict] = None) -> Optional[dict]:
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {token}",
                                          "Accept": "application/vnd.github+json",
                                          "User-Agent": "adw-screenshots"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def upload(paths: Iterable[str], adw_id: str, owner: str, log: logging.Logger) -> Dict[str, str]:
    """{local path: public URL} for every screenshot that was uploaded."""
    token = os.getenv("GITHUB_PAT")
    if not token:
        log.info("screenshots stay local: GITHUB_PAT is not set")
        return {}
    target = f"{owner}/{REPO_NAME}"
    if _call("GET", f"{API}/repos/{target}", token) is None:
        _call("POST", f"{API}/user/repos", token,
              {"name": REPO_NAME, "description": "Screenshots for ADW review comments", "private": False,
               "auto_init": True})
    urls = {}
    for local in paths:
        path = Path(local)
        dest = f"adw/{adw_id}/{path.name}"
        existing = _call("GET", f"{API}/repos/{target}/contents/{dest}", token)
        body = {"message": f"Add {dest}", "content": base64.b64encode(path.read_bytes()).decode()}
        if existing and existing.get("sha"):
            body["sha"] = existing["sha"]
        _call("PUT", f"{API}/repos/{target}/contents/{dest}", token, body)
        urls[local] = f"https://raw.githubusercontent.com/{target}/main/{dest}"
    return urls
