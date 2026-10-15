"""Rubric: seven delivery dimensions scored 0-10, every lost point traceable to a flaw card.

    S_d = max(0, 10 - (60 / T) * sum_{f in d} c(sev_f) - g_d)

T is the speaking time in seconds (so a longer speech is not punished for its length),
c() is the per-severity cost table and g_d a bounded penalty for an overall style that sits
far outside the reference group (only for pacing and intonation, where "overall" is
meaningful and not just a microphone setting).
"""
from __future__ import annotations

import math

import numpy as np

from shruti.detect.core import DIMENSIONS, Region

DIM_LABEL = {"pacing": "Pacing", "pausing": "Pausing", "intonation": "Intonation", "projection": "Projection",
             "fluency": "Fluency", "clarity": "Clarity", "emphasis": "Emphasis"}


def style_notes(g: dict, P_summary: dict, ref_summaries: list[dict]) -> dict:
    """Overall-style observations: global tempo and pitch range relative to the reference group."""
    tempo = math.exp(g.get("tempo", 0.0))
    ref_rng = [s.get("f0_range_st") for s in ref_summaries if s.get("f0_range_st")]
    rng_ratio = (P_summary.get("f0_range_st") or np.nan) / np.median(ref_rng) if ref_rng else np.nan
    notes = []
    if tempo < 0.88:
        notes.append(f"Overall you speak {100 * (1 / tempo - 1):.0f}% faster than the reference delivery.")
    elif tempo > 1.12:
        notes.append(f"Overall you speak {100 * (tempo - 1):.0f}% slower than the reference delivery.")
    if np.isfinite(rng_ratio) and rng_ratio < 0.75:
        notes.append(f"Your overall pitch range is {100 * rng_ratio:.0f}% of the reference group's.")
    return {"tempo_factor": round(tempo, 3), "pitch_range_ratio": None if not np.isfinite(rng_ratio) else round(float(rng_ratio), 3),
            "notes": notes}


def score(regions: list[Region], speaking_s: float, style: dict, cfg: dict) -> dict:
    rc = cfg["rubric"]
    cost = {int(k): float(v) for k, v in rc["severity_cost"].items()}
    T = max(speaking_s, 10.0)
    smax = float(rc["style_penalty_max"])
    style_pen = {d: 0.0 for d in DIMENSIONS}
    tf = style.get("tempo_factor") or 1.0
    style_pen["pacing"] = min(smax, max(0.0, (abs(math.log(tf)) - math.log(1.15)) / math.log(1.5) * smax))
    rr = style.get("pitch_range_ratio")
    if rr is not None:
        style_pen["intonation"] = min(smax, max(0.0, (0.8 - rr) / 0.4 * smax))
    dims = {}
    for d in DIMENSIONS:
        rs = [r for r in regions if r.dimension == d]
        flaw_pen = 60.0 / T * sum(cost[r.severity] for r in rs)
        s = max(0.0, 10.0 - flaw_pen - style_pen[d])
        dims[d] = {"label": DIM_LABEL[d], "score": round(s, 2), "flaw_penalty": round(flaw_pen, 2),
                   "style_penalty": round(style_pen[d], 2), "flaws": [r.region_id for r in rs]}
    w = rc["weights"]
    overall = sum(dims[d]["score"] * w[d] for d in DIMENSIONS) / sum(w[d] for d in DIMENSIONS)
    lo, hi = rc["wsdc"]["low"], rc["wsdc"]["high"]
    return {"dimensions": dims, "overall": round(overall, 2),
            "wsdc_style": round(lo + (hi - lo) * overall / 10.0, 1),
            "speaking_s": round(T, 2),
            "formula": "S_d = max(0, 10 - (60/T) * sum c(sev) - g_d); c = " + json_cost(cost)}


def json_cost(cost: dict) -> str:
    return "{" + ", ".join(f"{k}: {v}" for k, v in sorted(cost.items())) + "}"
