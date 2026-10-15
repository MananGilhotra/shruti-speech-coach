"""Ghost Coach: the speaker's own voice, with one flagged region re-delivered like the reference.

Only the flagged region changes. Timing and pitch use TD-PSOLA (Praat), so no voice model
is trained and no other person's voice is cloned:

    rho_w   = clamp(theta * d_ref_w / d_w, 0.5, 2.0)                  (word duration)
    F0*(t)  = F0_med * 2^{[(1-beta) st_user(t) + beta st_ref(t)] / 12}  (pitch contour)

Pauses are re-set to the reference pause (scaled by the speaker's tempo theta) with the
recording's own room tone; fillers and repeated onsets are cut; loudness is moved to the
reference level word by word.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import signal

from shruti import dsp
from shruti.baseline.population import Baseline
from shruti.dsp import SR, TimeMap
from shruti.features.word import Take

DEFAULT_FIXES = {"rushed": ["duration"], "dragged": ["duration"], "long_pause": ["pause"],
                 "missing_pause": ["pause"], "monotone": ["pitch"], "volume_fade": ["intensity"],
                 "mumble": ["brightness", "intensity"], "filler": ["cut"], "stutter": ["cut"],
                 "misplaced_emphasis": ["pitch", "intensity"]}
ALL_FIXES = ["duration", "pause", "pitch", "intensity", "brightness", "cut"]


def _high_shelf(x: np.ndarray, gain_db: float, f0: float = 2000.0) -> np.ndarray:
    """Simple high-shelf boost: add a high-passed copy (brightens a muffled stretch)."""
    sos = signal.butter(2, f0, btype="high", fs=SR, output="sos")
    return (x + (10 ** (gain_db / 20) - 1) * signal.sosfiltfilt(sos, x)).astype(np.float32)


def ghost(x: np.ndarray, P: Take, B: Baseline, region: dict, g: dict, cfg: dict,
          fixes: list[str] | None = None, blend: float | None = None) -> tuple[np.ndarray, dict]:
    """Return (audio, info). `region` is a flaw card (type, word_span, t_start, t_end)."""
    cc = cfg["coach"]
    ftype = region["type"]
    fixes = fixes or DEFAULT_FIXES[ftype]
    beta = float(cc["pitch_blend"] if blend is None else blend)
    lo_f, hi_f = cc["dur_factor_clamp"]
    i, j = region["word_span"]
    W = P.words
    R = B.takes[0]
    fr = P.frames
    tempo = math.exp(g.get("tempo", 0.0))
    total = len(x) / SR
    span_a = float(W["start"].iloc[i])
    span_b = float(W["end"].iloc[j])

    # ---- timing (duration) and pitch in one PSOLA pass, in the speaker's own timeline
    grid = np.arange(0.0, total + 0.005, 0.005)
    f = np.ones(len(grid))
    if "duration" in fixes:
        for k in range(i, j + 1):
            a, b = float(W["start"].iloc[k]), float(W["end"].iloc[k])
            target = float(np.exp(B.loc["log_dur"][k])) * tempo
            rho = float(np.clip(target / max(b - a, 0.02), lo_f, hi_f))
            w = np.interp(grid, [a - 1e-9, a, a + 0.01, b - 0.01, b, b + 1e-9], [0, 0, 1, 1, 0, 0])
            f *= 1 + (rho - 1) * w
    pitch_fn = None
    if "pitch" in fixes and R.frames.voiced.sum() > 10:
        rst = R.frames.f0_st
        rt = R.frames.times
        offset = g.get("f0_med_st", 0.0)
        spans = [(float(W["start"].iloc[k]), float(W["end"].iloc[k]), float(R.words["start"].iloc[k]),
                  float(R.words["end"].iloc[k])) for k in range(i, j + 1)]
        f0m = fr.f0_median_hz

        def pitch_fn(ts, hz):
            st = 12 * np.log2(hz / f0m)
            for ps, pe, rs_, re_ in spans:
                m = (ts >= ps) & (ts <= pe)
                if not m.any():
                    continue
                u = (ts[m] - ps) / max(pe - ps, 1e-3)
                rtime = rs_ + u * (re_ - rs_)
                ref_st = np.interp(rtime, rt, np.where(np.isfinite(rst), rst, np.nan))
                ok = np.isfinite(ref_st)
                st_m = st[m]
                st_m[ok] = (1 - beta) * st_m[ok] + beta * (ref_st[ok] + offset)
                st[m] = st_m
            return f0m * 2 ** (st / 12)

    if "duration" in fixes or pitch_fn is not None:
        y, tm = dsp.psola(x, fr.f0_floor, fr.f0_ceiling, dsp.compress_points(grid, f), pitch_fn)
    else:
        y, tm = x.copy(), TimeMap()
    rng = np.random.default_rng(0)

    # ---- loudness / brightness, in output time
    if "intensity" in fixes:
        gains = []
        for k in range(i, j + 1):
            d = float(B.loc["int_med_db"][k] + g.get("int_med_db", 0.0) - W["int_med_db"].iloc[k])
            gains.append((float(tm(W["start"].iloc[k])), float(tm(W["end"].iloc[k])), float(np.clip(d, -12, 12))))
        y = y * dsp.gain_envelope(len(y), gains, ramp_s=0.03)
    if "brightness" in fixes:
        a, b = float(tm(span_a)), float(tm(span_b))
        y = dsp.crossfade_replace(y, a, b, _high_shelf(y, 9.0))

    # ---- cuts and pauses (latest position first)
    ops = []
    if "cut" in fixes:
        gap = P.gaps[i] if ftype == "filler" and i < len(P.gaps) else P.gaps[max(0, j - 1)]
        if ftype == "filler":
            a = region.get("t_start", gap.voiced_start)
            b = region.get("t_end", gap.voiced_end)
        else:
            a, b = region["t_start"], region["t_end"]
        if a is not None and b is not None and b - a > 0.03:
            ops.append(("cut", float(tm(a)), float(tm(b))))
    if "pause" in fixes:
        for k in range(i, j + 1):
            if k >= len(P.gaps):
                continue
            gp = P.gaps[k]
            want = float(B.loc["pause_after"][k] * tempo) if np.isfinite(B.loc["pause_after"][k]) else 0.0
            have = gp.pause
            if have - want > 0.05 and gp.silence_start is not None:
                mid = 0.5 * (gp.silence_start + gp.silence_end)
                cut = have - max(want, 0.0)
                ops.append(("cut", float(tm(mid - cut / 2)), float(tm(mid + cut / 2))))
            elif want - have > 0.05:
                pos = float(tm(0.5 * (W["end"].iloc[k] + W["start"].iloc[k + 1])))
                ops.append(("insert", pos, want - have))
    for kind, a, b in sorted(ops, key=lambda o: -o[1]):
        if kind == "cut":
            y = dsp.delete(y, a, b)
            tm = tm.then(TimeMap.deletion(a, b))
        else:
            seg = dsp.room_tone(x, fr.silent, fr.hop, b, rng)
            y = dsp.insert(y, a, seg)
            tm = tm.then(TimeMap.insertion(a, b))
    peak = float(np.max(np.abs(y)))
    if peak > 0.98:
        y = y * (0.98 / peak)
    out_a = float(tm(span_a)) if ftype not in ("filler", "stutter") else float(tm(max(0.0, region["t_start"] - 0.3)))
    out_b = float(tm(span_b))
    return y.astype(np.float32), {"fixes": fixes, "blend": beta, "region_out": [round(out_a, 3), round(out_b, 3)],
                                  "duration_s": round(len(y) / SR, 3)}


def duet(ref_x: np.ndarray, R: Take, P: Take) -> np.ndarray:
    """The reference recording time-warped onto the speaker's word timing (for side-by-side playback)."""
    total = len(ref_x) / SR
    grid = np.arange(0.0, total + 0.005, 0.005)
    f = np.ones(len(grid))
    rs, re_ = R.words["start"].to_numpy(float), R.words["end"].to_numpy(float)
    ps, pe = P.words["start"].to_numpy(float), P.words["end"].to_numpy(float)
    for k in range(len(rs)):
        rho = float(np.clip((pe[k] - ps[k]) / max(re_[k] - rs[k], 0.02), 0.34, 2.9))
        w = np.interp(grid, [rs[k] - 1e-9, rs[k], re_[k], re_[k] + 1e-9], [0, 1, 1, 0])
        f = np.where(w > 0, rho, f)
        if k + 1 < len(rs) and rs[k + 1] - re_[k] > 0.05:
            rho_g = float(np.clip((ps[k + 1] - pe[k]) / (rs[k + 1] - re_[k]), 0.34, 2.9))
            wg = (grid > re_[k]) & (grid < rs[k + 1])
            f = np.where(wg, rho_g, f)
    y, _ = dsp.psola(ref_x, R.frames.f0_floor, R.frames.f0_ceiling, dsp.compress_points(grid, f))
    lead = int(max(0.0, ps[0] - rs[0] * f[0]) * SR)
    return np.concatenate([np.zeros(lead, np.float32), y]).astype(np.float32)
