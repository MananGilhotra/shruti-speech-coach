import numpy as np, pandas as pd
from shruti.config import load_config
from shruti.io.audio import load_audio
from shruti.process import process, load_scripts
from shruti.inject.engine import render, make_flaw, sample_nuisance
from shruti.baseline.population import build_baseline
from shruti.detect.core import run_tests
cfg = load_config(); s = load_scripts()["S1"]
x = load_audio("data/raw/" + s["source"]["file"], start=s["window"][0] - 0.3, end=s["window"][1])
src, _ = process(x, s["transcript"], cfg)
B = build_baseline("S1", [src], ["orig"], cfg)
rng = np.random.default_rng(11); _ = sample_nuisance(rng, cfg["inject"]["nuisance"])
taken, flaws = [], []
for ft in ["rushed","dragged","long_pause","missing_pause","monotone","volume_fade","mumble","filler","stutter","misplaced_emphasis"]:
    flaws += make_flaw(src, ft, 7, rng, f"f{len(flaws)+1}", taken)
r = render({"seed": 2, "nuisance": sample_nuisance(rng, cfg["inject"]["nuisance"]), "flaws": flaws}, src, x)
P, _ = process(r.audio, s["transcript"], cfg)
tests, g = run_tests(P, B, cfg)
lab = {l["type"]: l for l in r.labels}
for l in r.labels:
    i, j = l["words"]
    rel = [t for t in tests if t.ftype == l["type"] and t.i <= j and t.j >= i]
    best = min(rel, key=lambda t: t.p) if rel else None
    print(f"{l['type']:<18} words {i}-{j}: n_tests={len(rel)} best z={best.z if best else None!s:.6} p={best.p if best else 1:.2g} q={best.q if best else 1:.2g} practical={best.practical if best else None} stat={best.stat if best else 0:.3f}")
print("rejected:", sum(t.reject for t in tests), "of", len(tests))
print("gap 39:", P.gaps[39]); print("word 39/40:", P.words.iloc[39:41][["word","start","end","dur"]].to_dict("records"))
