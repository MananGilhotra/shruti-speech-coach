"""Build the 24-clip set for the "Beat the Panel" adjudicator study.

6 clean clips (natural variation / different voice), 12 single-flaw clips spread over flaw
types and severities (including near-threshold levels 2-4), and 6 multi-flaw clips. Each clip
is cropped to at most 30 s around its flaws; labels are shifted to the clip's timeline and
kept server-side (raters never see them).
"""
from __future__ import annotations

import json

import numpy as np

from shruti.config import DATA_DIR
from shruti.io.audio import SR, load_audio, save_audio

STUDY = DATA_DIR / "study"
MAX_S = 30.0


def _crop(row: dict) -> tuple[np.ndarray, float, list[dict]]:
    x = load_audio(DATA_DIR / row["audio"])
    dur = len(x) / SR
    if dur <= MAX_S:
        return x, 0.0, row["labels"]
    labs = row["labels"]
    if labs:
        lo = min(l["t_start"] for l in labs)
        hi = max(l["t_end"] for l in labs)
        mid = 0.5 * (lo + hi)
    else:
        mid = dur / 2
    a = float(np.clip(mid - MAX_S / 2, 0, dur - MAX_S))
    kept = [{**l, "t_start": round(l["t_start"] - a, 3), "t_end": round(l["t_end"] - a, 3)}
            for l in labs if l["t_start"] >= a and l["t_end"] <= a + MAX_S]
    return x[int(a * SR): int((a + MAX_S) * SR)], a, kept


def build_study(seed: int = 7) -> list[dict]:
    from shruti.dataset.bench import load_labels
    rows = load_labels()
    rng = np.random.default_rng(seed)
    pick: list[dict] = []
    clean = [r for r in rows if r["layer"] in ("clean", "voice")]
    pick += [clean[i] for i in rng.choice(len(clean), 6, replace=False)]
    singles = [r for r in rows if r["layer"] == "single" and 2 <= r["level"] <= 9]
    types = sorted({r["flaw_type"] for r in singles})
    rng.shuffle(types)
    for k in range(12):
        t = types[k % len(types)]
        cand = [r for r in singles if r["flaw_type"] == t and r not in pick]
        pick.append(cand[int(rng.integers(len(cand)))])
    grads = [r for r in rows if r["layer"] == "gradient" and r["level"] >= 4]
    pick += [grads[i] for i in rng.choice(len(grads), 6, replace=False)]
    (STUDY / "audio").mkdir(parents=True, exist_ok=True)
    clips, keys = [], []
    for n, r in enumerate(pick, 1):
        x, offset, labs = _crop(r)
        cid = f"c{n:02d}"
        save_audio(STUDY / "audio" / f"{cid}.flac", x)
        clips.append({"clip_id": cid, "duration_s": round(len(x) / SR, 2), "script_id": r["script_id"]})
        keys.append({"clip_id": cid, "render_id": r["render_id"], "offset_s": round(offset, 3), "labels": labs,
                     "layer": r["layer"], "level": r.get("level")})
    # four clips come back later in the session: rater test-retest consistency
    import shutil
    for n, base in enumerate([clips[i]["clip_id"] for i in rng.choice(len(clips), 4, replace=False)], 1):
        cid = f"r{n:02d}"
        shutil.copy(STUDY / "audio" / f"{base}.flac", STUDY / "audio" / f"{cid}.flac")
        src = next(c for c in clips if c["clip_id"] == base)
        clips.append({**src, "clip_id": cid})
        keys.append({**next(k for k in keys if k["clip_id"] == base), "clip_id": cid, "repeat_of": base})
    (STUDY / "clips.json").write_text(json.dumps(clips, indent=1))
    (STUDY / "answer_key.json").write_text(json.dumps(keys, indent=1))
    return clips
