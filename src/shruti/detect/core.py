"""Statistical flaw detection.

1. Every hypothesis is a *test*: a word window (or gap) whose measured deviation from the
   population baseline gets a z-score and a p-value from a t reference distribution.
2. Benjamini-Hochberg controls the false discovery rate over all tests of the take.
3. A rejected test also has to pass a practical floor in physical units.
4. Surviving tests of the same flaw type merge into regions with start/end times.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy import stats

from shruti.baseline.population import Baseline, OFFSET_FEATURES, add_derived, window_f0_range
from shruti.features.word import Take

FLAW_TYPES = ["rushed", "dragged", "long_pause", "missing_pause", "monotone", "volume_fade", "mumble",
              "filler", "stutter", "misplaced_emphasis"]
DIMENSION = {"rushed": "pacing", "dragged": "pacing", "long_pause": "pausing", "missing_pause": "pausing",
             "monotone": "intonation", "volume_fade": "projection", "mumble": "clarity", "filler": "fluency",
             "stutter": "fluency", "misplaced_emphasis": "emphasis"}
DIMENSIONS = ["pacing", "pausing", "intonation", "projection", "fluency", "clarity", "emphasis"]


@dataclass
class Test:
    family: str
    ftype: str
    i: int                       # first word (for gap tests: the word before the gap)
    j: int                       # last word (inclusive)
    stat: float                  # effect in physical units
    z: float
    p: float
    practical: bool
    evidence: dict = field(default_factory=dict)
    q: float = 1.0
    reject: bool = False


@dataclass
class Region:
    ftype: str
    i: int
    j: int
    t_start: float
    t_end: float
    z: float
    p: float
    q: float
    severity: int
    tests: list[Test]
    evidence: dict = field(default_factory=dict)
    ci_start: tuple[float, float] | None = None
    ci_end: tuple[float, float] | None = None
    confidence: float | None = None
    region_id: str = ""

    @property
    def dimension(self) -> str:
        return DIMENSION[self.ftype]

    @property
    def strongest(self) -> Test:
        return min(self.tests, key=lambda t: (t.p, -abs(t.z)))


# --------------------------------------------------------------------------- helpers
def benjamini_hochberg(p: np.ndarray, q: float) -> tuple[np.ndarray, np.ndarray]:
    """Return (reject mask, BH-adjusted q-values)."""
    p = np.asarray(p, dtype=float)
    m = len(p)
    if m == 0:
        return np.zeros(0, bool), np.zeros(0)
    order = np.argsort(p, kind="mergesort")
    ranked = p[order] * m / np.arange(1, m + 1)
    adj = np.minimum.accumulate(ranked[::-1])[::-1]
    qvals = np.empty(m)
    qvals[order] = np.minimum(adj, 1.0)
    passed = np.flatnonzero(p[order] <= q * np.arange(1, m + 1) / m)
    reject = np.zeros(m, dtype=bool)
    if len(passed):
        reject[order[: passed[-1] + 1]] = True
    return reject, qvals


def window_sd(s: np.ndarray, rho: float) -> float:
    """SD of the mean of k correlated deviations with spreads s and pairwise correlation rho."""
    k = len(s)
    var = (1 - rho) * np.sum(s ** 2) + rho * np.sum(s) ** 2
    return float(np.sqrt(var) / k)


def severity_from_z(z: float, bands: list[float]) -> int:
    a = abs(z)
    sev = 0
    for b in bands:
        if a >= b:
            sev += 1
    return max(1, min(5, sev))


def global_offsets(P: Take, B: Baseline) -> dict[str, float]:
    """Each speaker's overall level (pitch, loudness, brightness) and overall tempo vs the baseline."""
    from shruti.baseline.population import articulation_windows

    g = {}
    for feat in OFFSET_FEATURES:
        d = P.words[feat].to_numpy(float) - B.loc[feat]
        g[feat] = float(np.nanmedian(d)) if np.isfinite(d).any() else 0.0
    k = min(B.art_win) if B.art_win else None
    if k is not None:
        lr = np.log(np.maximum(articulation_windows(P, k), 0.02) / B.art_win[k])
        g["tempo"] = float(np.nanmedian(lr))
    else:
        g["tempo"] = g["log_dur"]
    return g


# --------------------------------------------------------------------------- test families
def tempo_tests(P, B, g, cfg, df_) -> list[Test]:
    """Rushed / dragged: articulation time of a word window vs the baseline.

    Articulation time = window span minus pauses and hesitation material, so the alignment
    error at internal word boundaries cancels; only the two outer edges add noise.
    """
    from shruti.baseline.population import articulation_windows

    rho = cfg["detect"]["neighbour_rho"]
    thr = cfg["detect"]["practical"]["tempo_log_ratio"]
    s0 = float(cfg["baseline"]["priors"]["log_dur"])
    sigma_b = float(cfg["baseline"].get("boundary_noise_s", 0.025))
    nu0 = float(cfg["baseline"]["nu0"])
    syl = P.words["n_syl"].to_numpy(float)
    tempo = math.exp(g["tempo"])
    max_gap = float(cfg["detect"].get("ipu_gap_s", 0.25))
    # a window may not straddle a pause or hesitation: speech rate is compared within phrases
    breaks = (np.nan_to_num(B.loc["pause_after"]) >= max_gap) | (
        np.nan_to_num(P.words["nonspeech_after"].to_numpy(float)) >= max_gap)
    out = []
    for k, ref in B.art_win.items():
        artP = articulation_windows(P, k)
        s_phrase = s0 * math.sqrt((1 + (k - 1) * rho) / k)
        R = B.art_win_refs.get(k)
        if R is not None and len(R) > 2:
            emp = 1.4826 * np.median(np.abs(np.log(R / ref[None, :])), axis=0)
            m = len(R)
            s_win = np.sqrt((nu0 * s_phrase ** 2 + (m - 1) * emp ** 2) / (nu0 + m - 1))
        else:
            s_win = np.full(len(ref), s_phrase)
        for i in range(len(ref)):
            if breaks[i:i + k - 1].any():
                continue
            dp, dr = artP[i], ref[i] * tempo
            if not (dp > 0.02 and dr > 0.02):
                continue
            l = float(np.log(dp / dr))
            sd = math.sqrt(s_win[i] ** 2 + 2 * sigma_b ** 2 / dr ** 2)
            z = l / sd
            p = 2 * stats.t.sf(abs(z), df_)
            ftype = "rushed" if l < 0 else "dragged"
            out.append(Test("tempo", ftype, i, i + k - 1, l, z, p, abs(l) >= thr, {
                "rate_obs": float(syl[i:i + k].sum() / dp), "rate_exp": float(syl[i:i + k].sum() / dr),
                "ratio": float(np.exp(-l)), "dur_obs": float(dp), "dur_exp": float(dr),
                "tempo_factor": tempo, "sd": sd}))
    if cfg["detect"].get("phrase_tempo", True):
        out += phrase_tempo_tests(P, B, breaks, tempo, s0, rho, sigma_b, thr, syl, df_)
    return out


def phrase_tempo_tests(P, B, breaks, tempo, s0, rho, sigma_b, thr, syl, df_) -> list[Test]:
    """Whole inter-pause phrases: both edges sit on silences, so boundary noise is small."""
    W = len(P.words)
    edges = [0] + [i + 1 for i in range(W - 1) if breaks[i]] + [W]
    st, en = P.words["start"].to_numpy(float), P.words["end"].to_numpy(float)
    ns = P.words["nonspeech_after"].to_numpy(float)
    ref_dur = np.exp(B.loc["log_dur"])
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        k = b - a
        if k < 3:
            continue
        dp = (en[b - 1] - st[a]) - np.nansum(ns[a:b - 1])
        dr = 0.0
        for t in B.takes:           # reference articulation time of the same phrase
            tst, ten = t.words["start"].to_numpy(float), t.words["end"].to_numpy(float)
            tns = t.words["nonspeech_after"].to_numpy(float)
            dr += (ten[b - 1] - tst[a]) - np.nansum(tns[a:b - 1])
        dr = dr / max(len(B.takes), 1) * tempo if B.takes else float(ref_dur[a:b].sum()) * tempo
        if not (dp > 0.05 and dr > 0.05):
            continue
        l = float(np.log(dp / dr))
        s_phrase = s0 * math.sqrt((1 + (k - 1) * rho) / k)
        sd = math.sqrt(s_phrase ** 2 + 2 * (0.6 * sigma_b) ** 2 / dr ** 2)
        z = l / sd
        p = 2 * stats.t.sf(abs(z), df_)
        out.append(Test("tempo", "rushed" if l < 0 else "dragged", a, b - 1, l, z, p, abs(l) >= thr, {
            "rate_obs": float(syl[a:b].sum() / dp), "rate_exp": float(syl[a:b].sum() / dr),
            "ratio": float(np.exp(-l)), "dur_obs": float(dp), "dur_exp": float(dr), "tempo_factor": tempo,
            "sd": sd, "phrase": True}))
    return out


def pause_tests(P, B, g, cfg, df_) -> list[Test]:
    pr = cfg["detect"]["practical"]
    tempo = math.exp(g["tempo"])
    x = P.words["pause_after"].to_numpy(float)
    m = B.loc["pause_after"] * tempo
    s = B.scale["pause_after"]
    out = []
    for i in range(len(x) - 1):
        if not (np.isfinite(x[i]) and np.isfinite(m[i])):
            continue
        delta = float(x[i] - m[i])
        z = delta / s[i]
        p = 2 * stats.t.sf(abs(z), df_)
        if delta >= 0:
            ftype, practical = "long_pause", delta >= pr["pause_long_extra_s"]
        else:
            ftype = "missing_pause"
            practical = m[i] >= pr["pause_missing_ref_s"] and x[i] <= pr["pause_missing_keep"] * m[i]
        out.append(Test("pause", ftype, i, i, delta, z, p, bool(practical),
                        {"pause_obs": float(x[i]), "pause_exp": float(m[i]), "sd": float(s[i])}))
    return out


def level_tests(P, B, g, cfg, df_) -> list[Test]:
    d = P.words["int_med_db"].to_numpy(float) - B.loc["int_med_db"] - g["int_med_db"]
    s = B.scale["int_med_db"]
    rho = cfg["detect"]["neighbour_rho"]
    thr = cfg["detect"]["practical"]["level_drop_db"]
    out = []
    for k in cfg["detect"]["windows"]["level"]:
        for i in range(len(d) - k + 1):
            seg = d[i:i + k]
            if not np.isfinite(seg).all():
                continue
            mean = float(seg.mean())
            sd = window_sd(s[i:i + k], rho)
            z = mean / sd
            p = stats.t.cdf(z, df_)            # one-sided: only a drop is a flaw
            out.append(Test("level", "volume_fade", i, i + k - 1, mean, z, p, mean <= -thr,
                            {"db_drop": mean, "sd": sd}))
    return out


def clarity_tests(P, B, g, cfg, df_) -> list[Test]:
    """Mumbling: the voice loses brightness (spectral tilt, centroid) and periodicity (CPP)."""
    names = ("tilt_db", "cent_oct", "cpp_db")
    comps = []
    for feat in names:
        z = (P.words[feat].to_numpy(float) - B.loc[feat] - g.get(feat, 0.0)) / B.scale[feat]
        comps.append(z)
    C = np.vstack(comps)
    ok = np.sum(np.isfinite(C[:2]), axis=0) == 2
    c = np.where(ok, 0.5 * (C[0] + C[1]), np.nan)    # brightness: spectral tilt and centroid
    per_word_sd = math.sqrt((1 + 0.6) / 2)            # two components, correlation ~0.6
    rho = cfg["detect"]["neighbour_rho"]
    thr = cfg["detect"]["practical"]["clarity_z"]
    out = []
    for k in cfg["detect"]["windows"]["clarity"]:
        for i in range(len(c) - k + 1):
            seg = c[i:i + k]
            if not np.isfinite(seg).all():
                continue
            mean = float(seg.mean())
            sd = window_sd(np.full(k, per_word_sd), rho)
            z = mean / sd
            p = stats.t.cdf(z, df_)
            ev = {f"{f}_z": float(np.nanmean(C[n, i:i + k])) for n, f in enumerate(("tilt", "centroid", "cpp"))}
            ev["composite"] = mean
            out.append(Test("clarity", "mumble", i, i + k - 1, mean, z, p, mean <= -thr, ev))
    return out


def monotone_tests(P, B, cfg, df_) -> list[Test]:
    thr = cfg["detect"]["practical"]["monotone_log_ratio"]
    s0 = cfg["baseline"]["priors"]["f0_range_log"]
    out = []
    W = len(P.words)
    for k, ref in B.win_range.items():
        rP = np.array([window_f0_range(P, i, i + k - 1) for i in range(W - k + 1)])
        lr = np.log(np.maximum(rP, 0.3) / np.maximum(ref, 0.3))
        gk = float(np.nanmedian(lr)) if np.isfinite(lr).any() else 0.0
        R = B.win_range_refs.get(k)
        if R is not None and len(R) > 2:
            lref = np.log(np.maximum(R, 0.3) / np.maximum(ref, 0.3)[None, :])
            s_emp = 1.4826 * np.nanmedian(np.abs(lref), axis=0)
            nu0, n = cfg["baseline"]["nu0"], len(R)
            s = np.sqrt((nu0 * s0 ** 2 + (n - 1) * np.nan_to_num(s_emp, nan=s0) ** 2) / (nu0 + n - 1))
        else:
            s = np.full(len(ref), s0)
        for i in range(len(lr)):
            if not np.isfinite(lr[i]):
                continue
            l = float(lr[i] - min(gk, 0.0))       # never forgive a local drop because the take is lively
            z = l / s[i]
            p = stats.t.cdf(z, df_)
            out.append(Test("monotone", "monotone", i, i + k - 1, l, z, p, l <= -thr,
                            {"range_obs_st": float(rP[i]), "range_exp_st": float(ref[i]),
                             "ratio": float(np.exp(l)), "sd": float(s[i])}))
    return out


def emphasis_tests(P, B, g, cfg, df_) -> list[Test]:
    """Stress on the wrong word: pitch peak and loudness peak both move against the baseline."""
    pr = cfg["detect"]["practical"]
    d_int = P.words["int_max_db"].to_numpy(float) - B.loc["int_max_db"] - g["int_max_db"]
    d_f0 = P.words["f0_max_st"].to_numpy(float) - B.loc["f0_max_st"] - g["f0_max_st"]
    z_int = d_int / B.scale["int_max_db"]
    z_f0 = d_f0 / B.scale["f0_max_st"]
    rho_pi = 0.3
    is_fn = P.words["is_function"].to_numpy(bool)
    ref_prom = B.loc["prom_pi"]
    out = []
    for i in range(len(d_int)):
        if not (np.isfinite(z_int[i]) and np.isfinite(z_f0[i])):
            continue
        z = float((z_int[i] + z_f0[i]) / math.sqrt(2 + 2 * rho_pi))
        p = 2 * stats.t.sf(abs(z), df_)
        low_ref = bool(is_fn[i] or (np.isfinite(ref_prom[i]) and ref_prom[i] < 0.0))
        key_ref = bool(np.isfinite(ref_prom[i]) and ref_prom[i] >= 1.0)
        if not (low_ref or key_ref):
            continue                      # emphasis can only be misplaced on a weak word or missing on a key word
        if z > 0:
            kind = "over"
            practical = low_ref and d_int[i] >= pr["emphasis_db"] and d_f0[i] >= pr["emphasis_st"]
        else:
            kind = "under"
            practical = key_ref and d_int[i] <= -pr["emphasis_db"] and d_f0[i] <= -pr["emphasis_st"]
        out.append(Test("emphasis", "misplaced_emphasis", i, i, float(d_int[i]), z, p, bool(practical),
                        {"kind": kind, "db_delta": float(d_int[i]), "st_delta": float(d_f0[i]),
                         "function_word": bool(is_fn[i]), "ref_prominence": float(np.nan_to_num(ref_prom[i]))}))
    return out


# --------------------------------------------------------------------------- regions
def _times_for(P: Take, ftype: str, i: int, j: int, tests: list[Test]) -> tuple[float, float]:
    w = P.words
    if ftype == "long_pause":
        gap = P.gaps[i]
        if gap.silence_start is not None:
            return gap.silence_start, gap.silence_end
        return float(w["end"].iloc[i]), float(w["start"].iloc[i + 1])
    if ftype == "missing_pause":
        c = 0.5 * (float(w["end"].iloc[i]) + float(w["start"].iloc[i + 1]))
        return c - 0.25, c + 0.25
    if ftype in ("filler", "stutter"):
        ev = tests[0].evidence
        return ev["t_start"], ev["t_end"]
    return float(w["start"].iloc[i]), float(w["end"].iloc[j])


def build_regions(P: Take, tests: list[Test], cfg: dict) -> list[Region]:
    bands = cfg["rubric"]["severity_z"]
    merge_gap = int(cfg["detect"]["merge_gap_words"])
    hits = [t for t in tests if t.reject and t.practical]
    regions: list[Region] = []
    for ftype in FLAW_TYPES:
        hs = sorted([t for t in hits if t.ftype == ftype], key=lambda t: (t.i, t.j))
        if not hs:
            continue
        groups: list[list[Test]] = []
        mergeable = ftype not in ("long_pause", "missing_pause", "filler", "stutter", "misplaced_emphasis")
        for t in hs:
            if groups and mergeable and t.i <= max(x.j for x in groups[-1]) + merge_gap:
                groups[-1].append(t)
            elif groups and not mergeable and t.i == groups[-1][0].i and t.j == groups[-1][0].j:
                groups[-1].append(t)
            else:
                groups.append([t])
        for grp in groups:
            i, j = min(t.i for t in grp), max(t.j for t in grp)
            best = min(grp, key=lambda t: (t.p, -abs(t.z)))
            t0, t1 = _times_for(P, ftype, i, j, grp)
            regions.append(Region(ftype=ftype, i=i, j=j, t_start=round(t0, 3), t_end=round(t1, 3),
                                  z=best.z, p=best.p, q=best.q, severity=severity_from_z(best.z, bands),
                                  tests=grp, evidence=dict(best.evidence)))
    # A slow phrase whose extra time is the hesitation inside it is the hesitation, not a drag.
    fluency = [r for r in regions if r.ftype in ("filler", "stutter", "long_pause")]
    kept = []
    for r in regions:
        if r.ftype == "dragged":
            inside = [f for f in fluency if f.t_start < r.t_end and f.t_end > r.t_start]
            extra = r.evidence.get("dur_obs", 0.0) - r.evidence.get("dur_exp", 0.0)
            hes = sum(f.t_end - f.t_start for f in inside if f.ftype != "long_pause")
            if inside and hes >= 0.6 * extra:
                continue
        kept.append(r)
    regions = kept
    # Emphasis changes inside a flattened, faded or mumbled stretch are explained by that flaw.
    explainers = [r for r in regions if r.ftype in ("monotone", "volume_fade", "mumble", "rushed", "dragged")]
    regions = [r for r in regions if not (r.ftype == "misplaced_emphasis" and any(
        e.i - 1 <= r.i <= e.j + 1 for e in explainers))]
    regions.sort(key=lambda r: r.t_start)
    for n, r in enumerate(regions, 1):
        r.region_id = f"r{n}"
    return regions


ONE_SIDED_LOWER = {"level", "clarity", "monotone"}


def empirical_null(tests: list[Test], df_: float, en: dict) -> dict:
    """Re-standardise each family's z-scores by their own centre and spread (empirical null).

    Most tests in a recording are null, so the median and MAD of a family's z-scores estimate
    the null distribution for *this* speaker and *this* recording; flaws are the outliers.
    Bounds keep a short recording or an odd speaker from making the detector over-sensitive.
    """
    lo, hi = en.get("sd_bounds", [0.6, 2.5])
    mb = float(en.get("mean_bound", 0.5))
    info = {}
    for fam in en.get("families", []):
        ts = [t for t in tests if t.family == fam and np.isfinite(t.z)]
        if len(ts) < 15:
            continue
        z = np.array([t.z for t in ts])
        mu = float(np.clip(np.median(z), -mb, mb))
        sd = float(np.clip(1.4826 * np.median(np.abs(z - np.median(z))), lo, hi))
        for t in ts:
            t.evidence["z_theoretical"] = t.z
            t.evidence["mu0"], t.evidence["sigma0"] = mu, sd
            t.z = (t.z - mu) / sd
            if fam in ONE_SIDED_LOWER:
                t.p = float(stats.t.cdf(t.z, df_))
            else:
                t.p = float(2 * stats.t.sf(abs(t.z), df_))
        info[fam] = {"mu0": mu, "sigma0": sd, "n": len(ts)}
    return info


# --------------------------------------------------------------------------- entry point
def run_tests(P: Take, B: Baseline, cfg: dict) -> tuple[list[Test], dict]:
    from shruti.detect.fluency import fluency_tests

    add_derived(P)
    if len(P.words) != B.n_words:
        raise ValueError("participant take and baseline cover different scripts")
    g = global_offsets(P, B)
    df_ = B.df
    tests = (tempo_tests(P, B, g, cfg, df_) + pause_tests(P, B, g, cfg, df_) + level_tests(P, B, g, cfg, df_)
             + clarity_tests(P, B, g, cfg, df_) + monotone_tests(P, B, cfg, df_) + emphasis_tests(P, B, g, cfg, df_)
             + fluency_tests(P, B, cfg))
    if cfg["detect"].get("encoder", {}).get("enabled"):
        from shruti.encoder.score import encoder_tests
        tests += encoder_tests(P, B, cfg)
    en = cfg["detect"].get("empirical_null", {})
    if en.get("enabled"):
        empirical_null(tests, df_, en)
    if tests:
        reject, qv = benjamini_hochberg(np.array([t.p for t in tests]), cfg["detect"]["fdr_q"])
        for t, r, qq in zip(tests, reject, qv):
            t.reject, t.q = bool(r), float(qq)
    return tests, g


def detect(P: Take, B: Baseline, cfg: dict) -> tuple[list[Region], list[Test], dict]:
    tests, g = run_tests(P, B, cfg)
    regions = build_regions(P, tests, cfg)
    return regions, tests, g
