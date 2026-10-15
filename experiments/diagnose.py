"""For each single-flaw dev file: best same-family test at the labelled words (z, practical, BH)."""
import json, sys, numpy as np, collections
from shruti.config import load_config, DATA_DIR
from shruti.dataset.bench import load_labels
from shruti.io.audio import load_audio
from shruti.process import load_scripts
from shruti.store import processed_take, get_baseline
from shruti.detect.core import run_tests
FAM = {"rushed":"tempo","dragged":"tempo","long_pause":"pause","missing_pause":"pause","monotone":"monotone","volume_fade":"level","mumble":"clarity","misplaced_emphasis":"emphasis","filler":"fluency","stutter":"fluency"}
cfg = load_config()
types = sys.argv[1:] or list(FAM)
rows = [l for l in load_labels("dev") if l["layer"] == "single" and l["flaw_type"] in types]
out = collections.defaultdict(list)
for it in rows:
    sid = it["script_id"]
    x = load_audio(DATA_DIR / it["audio"])
    P, _ = processed_take(x, load_scripts()[sid]["transcript"], cfg)
    B = get_baseline(sid, cfg, only_original=True)
    tests, g = run_tests(P, B, cfg)
    for lab in it["labels"]:
        i, j = lab["words"]
        cand = [t for t in tests if t.ftype == lab["type"] and t.i <= j and t.j >= i]
        best = min(cand, key=lambda t: t.p) if cand else None
        out[lab["type"]].append((it["level"], lab["param"], best.stat if best else None, best.z if best else None, best.p if best else None, best.practical if best else None, best.reject if best else None))
for t, v in out.items():
    print("==", t)
    for lv, prm, st, z, p, pr, rj in sorted(v, key=lambda r: (r[0], r[2] if r[2] is not None else -99)):
        print(f"  L{lv:2d} param={prm:8.3f}  stat={st if st is None else round(st,3)!s:>8}  z={z if z is None else round(z,2)!s:>7}  p={p if p is None else f'{p:.1e}'}  practical={pr} reject={rj}")
