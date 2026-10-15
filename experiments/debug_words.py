import numpy as np, pandas as pd
from shruti.config import load_config
from shruti.io.audio import load_audio
from shruti.process import process, load_scripts
from shruti.inject.engine import render, make_flaw, sample_nuisance
cfg = load_config(); s = load_scripts()["S1"]
x = load_audio("data/raw/" + s["source"]["file"], start=s["window"][0] - 0.3, end=s["window"][1])
src, _ = process(x, s["transcript"], cfg)
rng = np.random.default_rng(11)
_ = sample_nuisance(rng, cfg["inject"]["nuisance"])
taken, flaws = [], []
for ft in ["rushed","dragged","long_pause","missing_pause","monotone","volume_fade","mumble","filler","stutter","misplaced_emphasis"]:
    flaws += make_flaw(src, ft, 7, rng, f"f{len(flaws)+1}", taken)
recipe = {"seed": 2, "nuisance": sample_nuisance(rng, cfg["inject"]["nuisance"]), "flaws": flaws}
r = render(recipe, src, x)
P, _ = process(r.audio, s["transcript"], cfg)
tempo = recipe["nuisance"]["tempo"]
d = pd.DataFrame({"word": src.words.word, "src_dur": src.words.dur, "P_dur": P.words.dur,
                  "logratio": np.log(P.words.dur/src.words.dur), "src_start": src.words.start, "P_start": P.words.start, "P_end": P.words.end,
                  "gapv_P": P.words.gap_voiced_s, "pause_P": P.words.pause_after})
pd.set_option("display.width", 200)
for a,b in [(4,15),(37,44),(49,56),(57,64),(63,68)]:
    print(d.iloc[a:b].round(3).to_string()); print()
print("flaws:", [(f["type"], f["words"]) for f in flaws])
print("tempo nuisance", tempo)
