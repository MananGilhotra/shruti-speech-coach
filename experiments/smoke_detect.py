"""Smoke test: inject flaws into one original, analyse blind, compare regions with labels."""
import sys, time, numpy as np
from shruti.config import load_config
from shruti.io.audio import load_audio
from shruti.process import process, load_scripts
from shruti.inject.engine import render, make_flaw, sample_nuisance
from shruti.baseline.population import build_baseline
from shruti.detect.core import detect

sid = sys.argv[1] if len(sys.argv) > 1 else "S1"
level = int(sys.argv[2]) if len(sys.argv) > 2 else 7
cfg = load_config()
s = load_scripts()[sid]
x = load_audio("data/raw/" + s["source"]["file"], start=s["window"][0] - 0.3, end=s["window"][1])
src, _ = process(x, s["transcript"], cfg)
B = build_baseline(sid, [src], ["orig"], cfg)
rng = np.random.default_rng(11)

def run(recipe, name):
    r = render(recipe, src, x)
    P, rep = process(r.audio, s["transcript"], cfg)
    t = time.time(); regions, tests, g = detect(P, B, cfg)
    print(f"\n=== {name}: {len(tests)} tests, {sum(t.reject for t in tests)} rejected, {len(regions)} regions "
          f"(detect {time.time()-t:.2f}s) offsets: tempo={np.exp(g['log_dur']):.3f}")
    for l in r.labels:
        print(f"  LABEL {l['type']:<18} {l['t_start']:7.2f}-{l['t_end']:7.2f}  words {l['words']}")
    for rg in regions:
        print(f"  FOUND {rg.ftype:<18} {rg.t_start:7.2f}-{rg.t_end:7.2f}  words [{rg.i},{rg.j}] z={rg.z:+.2f} q={rg.q:.2g} sev={rg.severity}")

run({"seed": 1, "nuisance": sample_nuisance(rng, cfg["inject"]["nuisance"]), "flaws": []}, "clean variant")
taken, flaws = [], []
for ft in ["rushed", "dragged", "long_pause", "missing_pause", "monotone", "volume_fade", "mumble", "filler", "stutter", "misplaced_emphasis"]:
    flaws += make_flaw(src, ft, level, rng, f"f{len(flaws)+1}", taken)
run({"seed": 2, "nuisance": sample_nuisance(rng, cfg["inject"]["nuisance"]), "flaws": flaws}, f"all ten types at level {level}")
