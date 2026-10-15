"""Check that every rendered benchmark file matches the SHA-256 recorded in labels.jsonl."""
from __future__ import annotations

import json

from shruti.config import DATA_DIR
from shruti.io.audio import sha256_file

BENCH = DATA_DIR / "bench"


def verify_renders(limit: int | None = None) -> bool:
    rows = [json.loads(line) for line in open(BENCH / "labels.jsonl")]
    if limit:
        rows = rows[:limit]
    missing, bad = 0, []
    for r in rows:
        p = DATA_DIR / r["audio"]
        if not p.exists():
            missing += 1
            continue
        if sha256_file(p) != r["sha256"]:
            bad.append(r["render_id"])
    ok = not bad
    print(f"{len(rows) - missing - len(bad)}/{len(rows)} renders match their recorded SHA-256; "
          f"{missing} not rendered locally; {len(bad)} mismatched")
    for b in bad[:10]:
        print("  mismatch:", b)
    return ok
