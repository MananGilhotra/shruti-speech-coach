"""Analysis of the "Beat the Panel" adjudicator study.

Inputs: data/study/responses.jsonl (one line per rater x clip), answer_key.json, and SHRUTI's
own analysis of each clip. Outputs: inter-rater agreement (ICC), SHRUTI vs panel mean,
leave-one-judge-out comparison, localisation error of humans vs SHRUTI, and rater
self-consistency on repeated clips.
"""
from __future__ import annotations

import json
from collections import defaultdict

import numpy as np
from scipy import stats

from shruti.config import DATA_DIR, RESULTS_DIR
from shruti.io.audio import load_audio

STUDY = DATA_DIR / "study"


def icc2(ratings: np.ndarray) -> tuple[float, float]:
    """ICC(2,1) and ICC(2,k) (Shrout & Fleiss 1979) for an n_targets x k_raters matrix without NaNs."""
    n, k = ratings.shape
    grand = ratings.mean()
    ms_r = k * np.sum((ratings.mean(axis=1) - grand) ** 2) / (n - 1)
    ms_c = n * np.sum((ratings.mean(axis=0) - grand) ** 2) / (k - 1)
    ss_e = np.sum((ratings - ratings.mean(axis=1, keepdims=True) - ratings.mean(axis=0, keepdims=True) + grand) ** 2)
    ms_e = ss_e / ((n - 1) * (k - 1))
    icc21 = (ms_r - ms_e) / (ms_r + (k - 1) * ms_e + k * (ms_c - ms_e) / n)
    icc2k = (ms_r - ms_e) / (ms_r + (ms_c - ms_e) / n)
    return float(icc21), float(icc2k)


def analyse_panel() -> dict:
    from shruti.analyze import analyze

    responses = [json.loads(line) for line in open(STUDY / "responses.jsonl")]
    key = {k["clip_id"]: k for k in json.loads((STUDY / "answer_key.json").read_text())}
    base_of = {c: k.get("repeat_of", c) for c, k in key.items()}
    clips = sorted(c for c in key if "repeat_of" not in key[c])
    raters = sorted({r["rater_id"] for r in responses})
    score = defaultdict(dict)      # clip -> rater -> overall
    marks = defaultdict(list)      # clip -> list of mark times
    repeats = defaultdict(list)    # (rater, clip) -> overall scores
    for r in responses:
        o = r.get("scores", {}).get("overall")
        if o is None:
            continue
        base = base_of.get(r["clip_id"], r["clip_id"])
        repeats[(r["rater_id"], base)].append(float(o))
        if r["clip_id"] == base:
            score[base][r["rater_id"]] = float(o)
            marks[base] += [m["t"] for m in r.get("marks", []) if "t" in m]
    full = [c for c in clips if all(rt in score[c] for rt in raters)]
    M = np.array([[score[c][rt] for rt in raters] for c in full]) if full else np.zeros((0, len(raters)))
    out: dict = {"n_raters": len(raters), "n_clips_complete": len(full)}
    if len(full) >= 3 and len(raters) >= 2:
        out["icc2_1"], out["icc2_k"] = icc2(M)
    sys_scores, sys_err = {}, []
    for c in clips:
        x = load_audio(STUDY / "audio" / f"{c}.flac")
        res = analyze(x, key[c]["render_id"].split("__")[0], bootstrap=False)
        sys_scores[c] = res["rubric"]["overall"]
        for lab in key[c]["labels"]:
            if res["cards"]:
                d = min(abs(cd["t_start"] - lab["t_start"]) for cd in res["cards"])
                sys_err.append(d)
    if full:
        panel = M.mean(axis=1)
        sys_v = np.array([sys_scores[c] for c in full])
        out["system_vs_panel_spearman"] = float(stats.spearmanr(sys_v, panel).statistic)
        loo = {}
        for j, rt in enumerate(raters):
            others = np.delete(M, j, axis=1).mean(axis=1)
            loo[rt] = {"judge": float(stats.spearmanr(M[:, j], others).statistic),
                       "system": float(stats.spearmanr(sys_v, others).statistic)}
        out["leave_one_judge_out"] = loo
        out["mean_judge_loo"] = float(np.mean([v["judge"] for v in loo.values()]))
        out["mean_system_loo"] = float(np.mean([v["system"] for v in loo.values()]))
    human_err = []
    for c, ts in marks.items():
        for lab in key[c]["labels"]:
            if ts:
                human_err.append(min(abs(t - lab["t_start"]) for t in ts))
    out["localisation_error_s"] = {"human_median": float(np.median(human_err)) if human_err else None,
                                   "system_median": float(np.median(sys_err)) if sys_err else None}
    rep = [np.std(v) for v in repeats.values() if len(v) > 1]
    out["rater_test_retest_sd"] = float(np.mean(rep)) if rep else None
    out["system_test_retest_sd"] = 0.0   # analyses are deterministic (golden test)
    (RESULTS_DIR / "benchmark").mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "benchmark" / "panel.json").write_text(json.dumps(out, indent=1))
    return out
