"""Pre-computed analyses for Judge Mode and the audio pack for the benchmark explorer.

Everything here is small enough to ship in the repository, so the hosted demo shows real
results instantly, before anyone uploads a file.
"""
from __future__ import annotations

import json
import shutil

from shruti.analyze import analyze
from shruti.config import DATA_DIR
from shruti.io.audio import load_audio, save_audio

DEMOS = DATA_DIR / "demos"
DEMO_SPECS = [
    ("S1__gradient__b1-L09", "JFK 1961: long pause, flat pitch and a stutter",
     "Three flaws at severity 9 of 10 injected into a re-voiced copy of the inaugural address. All three are found, nothing else is flagged."),
    ("S3__gradient__b1-L09", "FDR 1941: hesitations and a fading voice",
     "Fillers made from FDR's own voice, an awkward pause and a fade, in a noisy 1941 recording. Five of five found."),
    ("S1__clean__0", "JFK 1961, natural variation only",
     "Tempo, word timing, pitch, loudness and timbre changed the way a different good reader would. SHRUTI should flag nothing."),
    ("S2__voice__3", "JFK 1962 as a different voice",
     "Formants and pitch moved to another speaker's range, nothing else. A speaker-agnostic system flags nothing."),
    ("S1__gradient__b1-L06", "Near the threshold: the same flaws at severity 6",
     "Milder versions of the first demo. Two of three are found; the mild monotone stretch is below the detection threshold."),
]
EXPLORER_SERIES = ["S1__gradient__b1", "S3__gradient__b1"]


def build_demos() -> None:
    from shruti.dataset.bench import load_labels
    rows = {r["render_id"]: r for r in load_labels()}
    DEMOS.mkdir(parents=True, exist_ok=True)
    index = []
    for rid, title, desc in DEMO_SPECS:
        if rid not in rows:
            print(f"skip {rid}: not in labels")
            continue
        x = load_audio(DATA_DIR / rows[rid]["audio"])
        res = analyze(x, rows[rid]["script_id"], bootstrap=True)
        d = DEMOS / res["analysis_id"]
        d.mkdir(parents=True, exist_ok=True)
        save_audio(d / "user.wav", x)
        res["demo"] = {"render_id": rid, "title": title, "description": desc, "labels": rows[rid]["labels"]}
        (d / "result.json").write_text(json.dumps(res))
        index.append({"id": rid, "title": title, "description": desc, "analysis_id": res["analysis_id"],
                      "script_id": rows[rid]["script_id"], "n_flags": len(res["cards"]),
                      "n_injected": len(rows[rid]["labels"]), "overall": res["rubric"]["overall"]})
        print(f"{rid}: {len(res['cards'])} flags / {len(rows[rid]['labels'])} injected, overall {res['rubric']['overall']}")
    (DEMOS / "index.json").write_text(json.dumps(index, indent=1))

    ex = DEMOS / "explorer"
    ex.mkdir(parents=True, exist_ok=True)
    pack = []
    for prefix in EXPLORER_SERIES:
        for r in sorted((r for r in rows.values() if r["render_id"].startswith(prefix)), key=lambda r: r["level"]):
            shutil.copy(DATA_DIR / r["audio"], ex / f"{r['render_id']}.flac")
            pack.append({k: r[k] for k in ("render_id", "script_id", "layer", "level", "labels", "duration_s", "bundle")
                         if k in r})
    (ex / "index.json").write_text(json.dumps(pack, indent=1))
    print(f"explorer pack: {len(pack)} files")
