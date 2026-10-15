"""Population baseline: what good deliveries of each word of a script look like.

For every word w and feature f we keep a location (median over reference takes after
removing each reference speaker's global offset) and a spread that is shrunk toward a
prior spread s0 (empirical Bayes, as in limma):

    s~^2 = (nu0 * s0^2 + (n - 1) * s^2) / (nu0 + n - 1)

With a single reference (n = 1) the spread is the prior; with ~30 human good takes the
data dominate. Degrees of freedom for the t reference distribution are nu0 + n - 1.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from shruti.features.word import Take

FEATURES = ["log_dur", "pause_after", "f0_med_st", "f0_max_st", "f0_range_st", "int_med_db", "int_max_db",
            "cpp_db", "hnr_db", "tilt_db", "cent_oct", "prominence", "prom_pi", "voiced_ratio"]
# features whose global per-speaker offset is removed before comparison
OFFSET_FEATURES = {"log_dur", "f0_med_st", "f0_max_st", "int_med_db", "int_max_db", "cpp_db", "hnr_db", "tilt_db",
                   "cent_oct"}


def _mad_scale(v: np.ndarray) -> float:
    v = v[np.isfinite(v)]
    if len(v) < 2:
        return np.nan
    return float(1.4826 * np.median(np.abs(v - np.median(v))))


def articulation_windows(take: Take, k: int) -> np.ndarray:
    """Articulation time of every k-word window: its span minus pauses and hesitation material."""
    st = take.words["start"].to_numpy(float)
    en = take.words["end"].to_numpy(float)
    ns = take.words["nonspeech_after"].to_numpy(float)
    W = len(st)
    return np.array([(en[i + k - 1] - st[i]) - np.nansum(ns[i:i + k - 1]) for i in range(W - k + 1)])


def window_f0_range(take: Take, i: int, j: int) -> float:
    """Pitch range (P90 - P10, semitones re speaker median) over words i..j inclusive."""
    fr = take.frames
    s = float(take.words["start"].iloc[i])
    e = float(take.words["end"].iloc[j])
    sl = fr.span(s, e)
    st = fr.f0_st[sl]
    st = st[np.isfinite(st)]
    if len(st) < 8:
        return np.nan
    return float(np.percentile(st, 90) - np.percentile(st, 10))


@dataclass
class Baseline:
    script_id: str
    n_refs: int
    ref_ids: list[str]
    words: list[dict]                  # per word: display, norm
    loc: dict[str, np.ndarray]         # feature -> [n_words]
    scale: dict[str, np.ndarray]       # feature -> [n_words] shrunk spread
    df: float
    ref_values: dict[str, np.ndarray]  # feature -> [n_refs, n_words] (offset-removed)
    art_win: dict[int, np.ndarray] = field(default_factory=dict)          # k -> [n_windows] articulation time
    art_win_refs: dict[int, np.ndarray] = field(default_factory=dict)     # k -> [n_refs, n_windows] (offset-removed)
    win_range: dict[int, np.ndarray] = field(default_factory=dict)        # k -> [n_windows] median F0 range
    win_range_refs: dict[int, np.ndarray] = field(default_factory=dict)   # k -> [n_refs, n_windows]
    priors: dict[str, float] = field(default_factory=dict)
    gap_voiced: np.ndarray | None = None     # median voiced seconds in each inter-word gap
    takes: list[Take] = field(default_factory=list, repr=False)

    @property
    def n_words(self) -> int:
        return len(self.words)

    def summary(self) -> dict:
        return {"script_id": self.script_id, "n_refs": self.n_refs, "ref_ids": self.ref_ids,
                "df": self.df, "priors": self.priors}


def _feature_matrix(takes: list[Take], feat: str) -> np.ndarray:
    return np.vstack([t.words[feat].to_numpy(dtype=float) for t in takes])


def add_derived(take: Take) -> None:
    """Pitch+loudness prominence (no duration term), used for emphasis tests."""
    df = take.words
    if "prom_pi" in df:
        return
    vals = []
    for col in ("f0_max_st", "int_max_db"):
        v = df[col].to_numpy(float)
        finite = v[np.isfinite(v)]
        scale = 1.4826 * np.median(np.abs(finite - np.median(finite))) if len(finite) > 3 else 1.0
        scale = scale if scale > 1e-6 else 1.0
        z = np.full(len(v), np.nan)
        for i in range(len(v)):
            nb = [v[j] for j in range(max(0, i - 2), min(len(v), i + 3)) if j != i and np.isfinite(v[j])]
            if np.isfinite(v[i]) and nb:
                z[i] = (v[i] - np.median(nb)) / scale
        vals.append(z)
    df["prom_pi"] = np.nanmean(np.vstack(vals), axis=0)


def build_baseline(script_id: str, takes: list[Take], ref_ids: list[str], cfg: dict,
                   windows: list[int] | None = None) -> Baseline:
    if not takes:
        raise ValueError("a baseline needs at least one reference take")
    n_words = len(takes[0].words)
    for t in takes:
        if len(t.words) != n_words:
            raise ValueError("all reference takes must be alignments of the same script")
        add_derived(t)
    priors = dict(cfg["baseline"]["priors"])
    priors.setdefault("prom_pi", priors.get("prominence", 0.9))
    nu0 = float(cfg["baseline"]["nu0"])
    n = len(takes)
    loc, scale, refvals = {}, {}, {}
    for feat in FEATURES:
        X = _feature_matrix(takes, feat)                         # [n, W]
        if feat in OFFSET_FEATURES and n > 1:
            m0 = np.nanmedian(X, axis=0)
            g = np.nanmedian(X - m0[None, :], axis=1)            # each reference's global offset
            X = X - g[:, None]
        refvals[feat] = X
        m = np.nanmedian(X, axis=0) if n > 1 else X[0].copy()
        s0 = float(priors[feat])
        if n > 1:
            s = np.array([_mad_scale(X[:, w]) for w in range(n_words)])
            s = np.where(np.isfinite(s), s, s0)
            k = np.sum(np.isfinite(X), axis=0).astype(float)
            s2 = (nu0 * s0 ** 2 + np.maximum(k - 1, 0) * s ** 2) / (nu0 + np.maximum(k - 1, 0))
        else:
            s2 = np.full(n_words, s0 ** 2)
        loc[feat] = m
        scale[feat] = np.sqrt(s2)
    # pause spread grows with the expected pause length (long pauses vary more between speakers)
    scale["pause_after"] = np.sqrt(scale["pause_after"] ** 2 + (0.15 * np.nan_to_num(loc["pause_after"])) ** 2)
    # alignment noise: each word edge is uncertain by ~sigma_b seconds, which matters most for short words
    sigma_b = float(cfg["baseline"].get("boundary_noise_s", 0.025))
    ref_dur = np.exp(loc["log_dur"])
    scale["log_dur"] = np.sqrt(scale["log_dur"] ** 2 + (np.sqrt(2) * sigma_b / np.maximum(ref_dur, 0.04)) ** 2)

    art_win, art_win_refs = {}, {}
    for k in cfg["detect"]["windows"]["tempo"]:
        A = np.log(np.maximum(np.array([articulation_windows(t, k) for t in takes]), 0.02))
        if n > 1:
            A = A - np.median(A - np.median(A, axis=0)[None, :], axis=1)[:, None]
        art_win_refs[k] = np.exp(A)
        art_win[k] = np.exp(np.median(A, axis=0))
    win_range, win_range_refs = {}, {}
    for k in (windows or cfg["detect"]["windows"]["monotone"]):
        R = np.array([[window_f0_range(t, i, i + k - 1) for i in range(n_words - k + 1)] for t in takes])
        win_range_refs[k] = R
        win_range[k] = np.nanmedian(R, axis=0) if n > 1 else R[0]
    gv = np.vstack([[g.voiced_s for g in t.gaps] for t in takes])
    return Baseline(script_id=script_id, n_refs=n, ref_ids=list(ref_ids),
                    words=[{"display": tok.display, "norm": tok.norm} for tok in takes[0].tokens],
                    loc=loc, scale=scale, df=nu0 + n - 1, ref_values=refvals,
                    art_win=art_win, art_win_refs=art_win_refs, win_range=win_range, win_range_refs=win_range_refs, priors=priors,
                    gap_voiced=np.median(gv, axis=0), takes=list(takes))


def subset(baseline: Baseline, idx: list[int], cfg: dict) -> Baseline:
    """Baseline rebuilt from a subset (with replacement allowed) of its reference takes."""
    takes = [baseline.takes[i] for i in idx]
    ids = [baseline.ref_ids[i] for i in idx]
    return build_baseline(baseline.script_id, takes, ids, cfg, windows=list(baseline.win_range))
