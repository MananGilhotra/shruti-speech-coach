"""Flaw Studio: elicited human flaws where the on-screen instruction is the label.

Each volunteer gets a deterministic assignment (derived from their pseudonymous id):
two scripts, and for each script one good take plus three instructed-flaw takes.
Flaw types and severities rotate across volunteers (a Latin-square style design), so the
dataset covers every type evenly without coordination.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

import numpy as np

from shruti.config import DATA_DIR, load_config
from shruti.inject.engine import FLAW_TYPES, choose_site
from shruti.process import load_scripts

STUDIO_DIR = DATA_DIR / "studio"
UPLOADS = STUDIO_DIR / "uploads"
ACCEPTED = STUDIO_DIR / "accepted"
CONSENT_VERSION = "1.0"

INSTRUCTIONS = {
    "rushed": "Rush the highlighted words: say them {sev} faster than the rest.",
    "dragged": "Drag the highlighted words out: say them {sev} slower than the rest.",
    "long_pause": "After the highlighted word, stop for an awkward pause ({sec}).",
    "missing_pause": "Do not pause after the highlighted word: run straight into the next one.",
    "monotone": "Say the highlighted words flat, on one note, like reading a list.",
    "volume_fade": "Let your voice fade away {sev} on the highlighted words.",
    "mumble": "Mumble the highlighted words: barely open your mouth.",
    "filler": "Say “uhh” or “umm” just before the highlighted word.",
    "stutter": "Stutter the start of the highlighted word, like “c-c-country”.",
    "misplaced_emphasis": "Stress the highlighted small word {sev}, and keep the word next to it flat.",
}
SEVERITY_WORDS = {"mild": "a little", "strong": "a lot"}


def safe_id(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "", s)[:40] or "anon"


def _h(*parts) -> int:
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def assignment(speaker_id: str) -> dict:
    """Two scripts x (1 good + 3 instructed flaws) for this volunteer."""
    from shruti.store import ORIGINALS_DIR, processed_take
    from shruti.io.audio import load_audio

    cfg = load_config()
    scripts = load_scripts()
    ids = sorted(scripts)
    h = _h("studio", speaker_id)
    chosen = [ids[h % len(ids)], ids[(h // len(ids) + 1 + h % len(ids)) % len(ids)]]
    if chosen[0] == chosen[1]:
        chosen[1] = ids[(ids.index(chosen[0]) + 1) % len(ids)]
    tasks = []
    for n, sid in enumerate(chosen):
        tasks.append({"task_id": f"{sid}-good", "script_id": sid, "kind": "good",
                      "instruction": {"text": "Listen to the original once, then deliver the passage as well as "
                                              "you can, in your own voice."}})
        x = load_audio(ORIGINALS_DIR / f"{sid}.flac")
        src, _ = processed_take(x, scripts[sid]["transcript"], cfg)
        rng = np.random.default_rng(_h("sites", speaker_id, sid))
        start = (h + 3 * n) % len(FLAW_TYPES)
        taken: list = []
        for k in range(3):
            ft = FLAW_TYPES[(start + k * 3) % len(FLAW_TYPES)]
            site = choose_site(src, ft, rng, taken=taken)
            if site is None:
                ft = "long_pause"
                site = choose_site(src, ft, rng, taken=taken)
            a, b = site["words"][0], site["words"][-1]
            taken.append((min(a, site.get("key_word", a)), max(b, site.get("key_word", b))))
            sev = "strong" if (h + n + k) % 2 else "mild"
            text = INSTRUCTIONS[ft].format(sev=SEVERITY_WORDS[sev], sec="about 2 seconds" if sev == "strong" else "about 1 second")
            tasks.append({"task_id": f"{sid}-{ft}", "script_id": sid, "kind": "flawed",
                          "instruction": {"type": ft, "severity": sev, "words": [a, b], "key_word": site.get("key_word"),
                                          "text": text}})
    return {"speaker_id": speaker_id, "consent_version": CONSENT_VERSION, "tasks": tasks}


def save_consent(payload: dict) -> dict:
    sid = safe_id(payload.get("speaker_id", ""))
    path = STUDIO_DIR / "consent" / f"{sid}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = {**payload, "speaker_id": sid, "consent_version": CONSENT_VERSION, "timestamp": int(time.time())}
    path.write_text(json.dumps(rec, indent=1))
    return rec


def has_consent(speaker_id: str) -> bool:
    p = STUDIO_DIR / "consent" / f"{safe_id(speaker_id)}.json"
    if not p.exists():
        return False
    rec = json.loads(p.read_text())
    return bool(rec.get("accepted") and rec.get("age_ok"))


def list_takes() -> list[dict]:
    out = []
    for meta in sorted(UPLOADS.glob("*/*.json")):
        out.append(json.loads(meta.read_text()))
    return out


def take_path(take_id: str) -> Path:
    spk, task = take_id.split("__", 1)
    return UPLOADS / safe_id(spk) / f"{task}.wav"
