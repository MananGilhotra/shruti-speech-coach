"""Fluency detectors: fillers ("um", "uh") and stutters (repeated word onsets).

Neither flaw leaves a word of the script behind, so we look at what the aligner could
not attribute to any word: voiced material between words (fillers) and short bursts
that repeat the onset of the next word (stutters). Each candidate becomes a Test with a
pseudo z-score so it joins the same Benjamini-Hochberg pass as every other test.
"""
from __future__ import annotations

import numpy as np
from scipy import stats

from shruti.detect.core import Test
from shruti.features.word import Take


from shruti.features.word import cmvn as _cmvn, merge_runs as _merge_runs, onset_similarity, runs as _runs  # noqa: E402


def repeated_onsets(take: Take, k: int, sc: dict) -> dict | None:
    """Bursts before word k that resemble its onset. Returns evidence or None."""
    fr = take.frames
    w = take.words
    a = float(w["end"].iloc[k - 1]) if k > 0 else max(0.0, float(w["start"].iloc[k]) - 1.0)
    b = float(w["end"].iloc[k])
    sl = fr.span(a, b)
    active = ~fr.quiet[sl]
    runs = _merge_runs(_runs(active, 3), 3)          # >= 30 ms of sound, dips >= 30 ms split runs
    if len(runs) < 2:
        return None
    mf = _cmvn(fr.mfcc)
    last_a, last_b = runs[-1]
    max_burst = int(round(sc["max_burst_s"] / fr.hop))
    reps, sims = [], []
    for ra, rb in runs[:-1]:
        if rb - ra > max_burst:
            continue
        sim = onset_similarity(mf, sl.start + ra, sl.start + rb, sl.start + last_a, sl.start + last_b)
        if sim >= sc["min_similarity"]:
            reps.append((ra, rb))
            sims.append(sim)
    if not reps:
        return None
    t0 = float(fr.times[sl.start + reps[0][0]])
    t1 = float(fr.times[sl.start + last_a])
    return {"t_start": round(t0, 3), "t_end": round(t1, 3), "n_repeats": len(reps),
            "similarity": round(max(sims), 3)}


def fluency_tests(P: Take, B, cfg: dict) -> list[Test]:
    fc = cfg["detect"]["filler"]
    sc = cfg["detect"]["stutter"]
    s0 = float(cfg["baseline"]["priors"]["gap_voiced_s"])
    fr = P.frames
    tests: list[Test] = []
    W = len(P.words)
    stutter_gaps: set[int] = set()

    for k in range(1, W):
        ev = repeated_onsets(P, k, sc)
        if ev is None:
            continue
        in_ref = any(repeated_onsets(t, k, sc) is not None for t in B.takes) if B.takes else False
        z = (ev["similarity"] - 0.75) / 0.04 + 0.5 * (ev["n_repeats"] - 1)
        p = float(stats.norm.sf(z))
        stutter_gaps.add(k - 1)
        tests.append(Test("fluency", "stutter", k - 1, k, float(ev["n_repeats"]), z, p, not in_ref,
                          {**ev, "word": str(P.words["word"].iloc[k]), "in_reference": in_ref}))

    gv_ref = B.gap_voiced if B.gap_voiced is not None else np.zeros(W - 1)
    for i, gap in enumerate(P.gaps):
        if gap.voiced_start is None:
            continue
        seg = gap.voiced_end - gap.voiced_start
        sl = fr.span(gap.voiced_start, gap.voiced_end)
        st = fr.f0_st[sl]
        st = st[np.isfinite(st)]
        f0_rng = float(np.percentile(st, 90) - np.percentile(st, 10)) if len(st) >= 5 else 99.0
        vfrac = float(np.mean(fr.voiced[sl])) if sl.stop > sl.start else 0.0
        delta = float(gap.voiced_s - gv_ref[i])
        z = delta / s0
        p = float(stats.norm.sf(z))
        practical = (fc["min_s"] <= seg <= fc["max_s"] and vfrac >= fc["min_voiced"]
                     and f0_rng <= fc["max_f0_range_st"] and delta >= 0.12 and i not in stutter_gaps)
        tests.append(Test("fluency", "filler", i, i + 1, delta, z, p, bool(practical), {
            "t_start": round(gap.voiced_start, 3), "t_end": round(gap.voiced_end, 3),
            "voiced_s": round(gap.voiced_s, 3), "ref_voiced_s": round(float(gv_ref[i]), 3),
            "f0_range_st": round(f0_rng, 2), "voiced_fraction": round(vfrac, 2)}))
    return tests
