"""Download the public-domain source recordings listed in data/scripts/scripts.json."""
from __future__ import annotations

import time
import urllib.request

from shruti.config import DATA_DIR
from shruti.io.audio import sha256_file
from shruti.process import load_scripts

RAW_DIR = DATA_DIR / "raw"
USER_AGENT = "SHRUTI/0.1 (educational research; https://github.com/)"


def download_sources() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    seen = set()
    for sid, s in load_scripts().items():
        src = s["source"]
        if src["file"] in seen:
            continue
        seen.add(src["file"])
        dst = RAW_DIR / src["file"]
        if dst.exists() and sha256_file(dst) == src["sha256"]:
            print(f"ok      {src['file']}")
            continue
        print(f"fetch   {src['file']}  <- {src['url']}", flush=True)
        req = urllib.request.Request(src["url"], headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=120) as r, open(dst, "wb") as f:
            f.write(r.read())
        got = sha256_file(dst)
        if got != src["sha256"]:
            raise RuntimeError(f"{src['file']}: SHA-256 {got} does not match the recorded {src['sha256']}")
        print(f"ok      {src['file']}  (sha256 verified)")
        time.sleep(2)  # be polite to Wikimedia
