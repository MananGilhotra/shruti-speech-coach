"""Bootstrap confidence for flaw regions.

Each replicate perturbs every word edge by Gaussian alignment noise (and, when the baseline
has three or more references, resamples the references). Detection re-runs on the
perturbed take; a region's confidence is the share of replicates that find a same-type
region overlapping it, and its 95% interval is the 2.5-97.5 percentile of their edges.
"""
from __future__ import annotations

import numpy as np

from shruti.align.ctc import AlignedWord
from shruti.baseline.population import Baseline, subset
from shruti.detect.core import Region, detect
from shruti.features.word import Take, build_take


def _jittered(P: Take, rng: np.random.Generator, sd: float, cfg: dict) -> Take:
    base = getattr(P, "aligned", None) or [
        AlignedWord(i, str(w), float(s), float(e), 0.0, ()) for i, (w, s, e) in
        enumerate(zip(P.words["word"], P.words["start"], P.words["end"]))]
    out, prev_end = [], 0.0
    for w in base:
        s = max(prev_end, w.start + rng.normal(0, sd))
        e = max(s + 0.02, w.end + rng.normal(0, sd))
        out.append(AlignedWord(w.index, w.text, float(s), float(e), w.score, w.char_times))
        prev_end = s
    return build_take(P.tokens, out, P.frames, cfg, P.duration)


def bootstrap_regions(P: Take, B: Baseline, regions: list[Region], cfg: dict) -> None:
    if not regions:
        return
    bc = cfg["detect"]["bootstrap"]
    rng = np.random.default_rng(int(bc["seed"]))
    reps: list[list[Region]] = []
    for _ in range(int(bc["B"])):
        Pb = _jittered(P, rng, float(bc["boundary_jitter_s"]), cfg)
        Bb = subset(B, list(rng.integers(0, B.n_refs, B.n_refs)), cfg) if B.n_refs >= 3 else B
        rb, _, _ = detect(Pb, Bb, cfg)
        reps.append(rb)
    for r in regions:
        starts, ends = [], []
        for rb in reps:
            cands = [x for x in rb if x.ftype == r.ftype and min(x.t_end, r.t_end) > max(x.t_start, r.t_start)]
            if cands:
                best = max(cands, key=lambda x: min(x.t_end, r.t_end) - max(x.t_start, r.t_start))
                starts.append(best.t_start)
                ends.append(best.t_end)
        r.confidence = round(len(starts) / len(reps), 3)
        if len(starts) >= 3:
            # the 10 ms analysis frame is the resolution floor of every edge
            res = float(cfg["features"]["hop_s"])
            lo_s, hi_s = np.percentile(starts, [2.5, 97.5])
            lo_e, hi_e = np.percentile(ends, [2.5, 97.5])
            r.ci_start = (round(float(min(lo_s, r.t_start) - res), 3), round(float(max(hi_s, r.t_start) + res), 3))
            r.ci_end = (round(float(min(lo_e, r.t_end) - res), 3), round(float(max(hi_e, r.t_end) + res), 3))
