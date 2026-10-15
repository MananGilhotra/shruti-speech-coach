import numpy as np, pandas as pd, sys
from shruti.config import load_config
from shruti.io.audio import load_audio
from shruti.process import process, load_scripts
from shruti.inject.engine import render, ladder_param, choose_site
from shruti.baseline.population import build_baseline
from shruti.detect.core import global_offsets
from shruti.align.ctc import Aligner
from shruti.text.words import tokenize
cfg = load_config(); s = load_scripts()["S1"]
x = load_audio("data/raw/" + s["source"]["file"], start=s["window"][0] - 0.3, end=s["window"][1])
src, _ = process(x, s["transcript"], cfg)
B = build_baseline("S1", [src], ["orig"], cfg)
pd.set_option("display.width", 220)
for lvl in (5, 8, 10):
    for ft, words, extra in (("mumble", [59, 62], {}), ("misplaced_emphasis", [16, 16], {"key_word": 17})):
        rec = {"seed": 0, "flaws": [{"flaw_id": "f1", "type": ft, "level": lvl, "param": ladder_param(ft, lvl), "words": words, **extra}]}
        r = render(rec, src, x)
        P, _ = process(r.audio, s["transcript"], cfg)
        g = global_offsets(P, B)
        i, j = words
        cols = ["tilt_db", "cent_oct", "cpp_db", "hnr_db", "int_med_db", "int_max_db", "f0_max_st"]
        d = {c: ((P.words[c] - B.loc[c] - g.get(c, 0)) / B.scale[c]).iloc[i:j + 1].round(2).tolist() for c in cols}
        raw = {c: (P.words[c] - B.loc[c] - g.get(c, 0)).iloc[i:j + 1].round(2).tolist() for c in cols}
        print(f"{ft} L{lvl} param={rec['flaws'][0]['param']:.2f}\n  z: {d}\n  raw: {raw}")
