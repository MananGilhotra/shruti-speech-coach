"""Word table: per-word prosodic summaries, refined word boundaries and pauses."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from shruti.align.ctc import AlignedWord
from shruti.features.frame import FrameFeatures
from shruti.text.words import Token


@dataclass
class Gap:
    """What lies between word i and word i+1."""
    after_word: int
    start: float
    end: float
    silence_start: float | None
    silence_end: float | None
    voiced_s: float
    voiced_start: float | None = None
    voiced_end: float | None = None
    filler_like: bool = False            # the voiced segment is long, steady and flat in pitch
    leading_kind: str | None = None      # "filler" / "stutter" material the aligner had glued to the next word
    leading_start: float | None = None
    leading_end: float | None = None
    n_repeats: int = 0
    similarity: float = 0.0

    @property
    def nonspeech(self) -> float:
        """Seconds between the words that are not articulation of the script (pause + fluency material)."""
        extra = 0.0
        if self.leading_kind == "stutter" and self.leading_start is not None:
            extra = self.leading_end - self.leading_start
        elif self.filler_like and self.voiced_start is not None:
            extra = self.voiced_end - self.voiced_start
        return self.pause + extra

    silence_total: float | None = None   # summed silent runs (a hesitation can split one pause)

    @property
    def pause(self) -> float:
        if self.silence_start is None:
            return 0.0
        if self.silence_total is not None:
            return self.silence_total
        return max(0.0, self.silence_end - self.silence_start)


@dataclass
class Take:
    """Everything SHRUTI knows about one recording of one script."""
    tokens: list[Token]
    words: pd.DataFrame
    gaps: list[Gap]
    frames: FrameFeatures
    duration: float
    summary: dict = field(default_factory=dict)
    aligned: list = field(default_factory=list, repr=False)   # raw CTC words (with character times)


def _longest_run(mask: np.ndarray) -> tuple[int, int]:
    best, cur_start, best_span = 0, None, (0, 0)
    for i, m in enumerate(np.append(mask, False)):
        if m and cur_start is None:
            cur_start = i
        elif not m and cur_start is not None:
            if i - cur_start > best:
                best, best_span = i - cur_start, (cur_start, i)
            cur_start = None
    return best_span


def refine_boundaries(aligned: list[AlignedWord], fr: FrameFeatures, pause_min: float
                      ) -> tuple[list[tuple[float, float]], list[Gap]]:
    """Measure each inter-word pause and move word edges onto silence edges.

    Silences (>= pause_min) are found over the whole recording first and then assigned to the
    nearest word boundary, so a pause is measured even when the aligner let a word run into it.
    """
    se = [(w.start, w.end) for w in aligned]
    silent = fr.silent
    voiced = fr.voiced
    sil_runs = [(float(fr.times[a]), float(fr.times[b - 1] + fr.hop)) for a, b in runs(silent, int(round(pause_min / fr.hop)))]
    mids = [0.5 * (a + b) for a, b in se]
    used: set[int] = set()
    snap = 0.08
    gaps: list[Gap] = []
    for i in range(len(se) - 1):
        (a0, a1), (b0, b1) = se[i], se[i + 1]
        lo, hi = a1 - 0.25, b0 + 0.25
        # every silent run between the two words' centres that sits in the inter-word region belongs
        # to this gap; a hesitation in the middle of a pause splits it into several runs
        mine = []
        for n, (s0, s1) in enumerate(sil_runs):
            if n in used or s1 <= mids[i] or s0 >= mids[i + 1]:
                continue
            if s1 > lo and s0 < hi:
                mine.append(n)
        end_i, start_n = a1, b0
        if mine:
            used.update(mine)
            segs = [(max(sil_runs[n][0], mids[i]), min(sil_runs[n][1], mids[i + 1])) for n in mine]
            s0, s1 = segs[0][0], segs[-1][1]
            end_i = s0 if s0 <= a1 + snap else a1
            start_n = s1 if s1 >= b0 - snap else b0
            gap = Gap(i, end_i, start_n, s0, s1, 0.0)
            gap.silence_total = float(sum(b - a for a, b in segs))
        else:
            if 0 < b0 - a1 < 0.15:
                end_i = start_n = 0.5 * (a1 + b0)
            gap = Gap(i, end_i, start_n, None, None, 0.0)
        end_i = max(a0 + 0.02, end_i)
        start_n = min(b1 - 0.02, start_n)
        se[i] = (a0, end_i)
        se[i + 1] = (start_n, b1)
        gap.start, gap.end = end_i, start_n
        # sound between the two words that belongs to no word and is not silence (filler / stutter candidates)
        if start_n - end_i >= 0.12:
            gs = fr.span(end_i, start_n)
            v = voiced[gs] & ~silent[gs]
            gap.voiced_s = float(v.sum() * fr.hop)
            if v.any():
                r0, r1 = _longest_run(v)
                gap.voiced_start = float(fr.times[gs.start + r0])
                gap.voiced_end = float(fr.times[gs.start + r1 - 1] + fr.hop)
        gaps.append(gap)
    return se, gaps


def runs(mask: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    out, start = [], None
    for i, m in enumerate(np.append(mask, False)):
        if m and start is None:
            start = i
        elif not m and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    return out


def merge_runs(rs: list[tuple[int, int]], max_gap: int) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for a, b in rs:
        if out and a - out[-1][1] < max_gap:
            out[-1][1] = b
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def cmvn(m: np.ndarray) -> np.ndarray:
    return (m - m.mean(axis=1, keepdims=True)) / (m.std(axis=1, keepdims=True) + 1e-8)


def onset_vec(mf: np.ndarray, a: int, b: int, n: int = 6) -> np.ndarray:
    return mf[1:, a:min(b, a + n)].mean(axis=1)


def cosine(u: np.ndarray, v: np.ndarray) -> float:
    return float(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9))


def onset_similarity(mf: np.ndarray, a: int, b: int, ta: int, tb: int, n_max: int = 8, max_lag: int = 3) -> float:
    """Frame-by-frame cosine similarity of a burst [a, b) with the onset of a target run [ta, tb).

    A small lag search absorbs the few frames by which the two runs' detected starts can differ.
    """
    best = 0.0
    for lag in range(-max_lag, max_lag + 1):
        ta2 = ta + lag
        if ta2 < 0:
            continue
        n = min(b - a, tb - ta2, n_max)
        if n < 2:
            continue
        X, Y = mf[1:, a:a + n], mf[1:, ta2:ta2 + n]
        num = np.sum(X * Y, axis=0)
        den = np.linalg.norm(X, axis=0) * np.linalg.norm(Y, axis=0) + 1e-9
        best = max(best, float(np.mean(num / den)))
    return best


def _flat_voiced(fr: FrameFeatures, seg: slice, fc: dict) -> bool:
    if seg.stop <= seg.start:
        return False
    vfrac = float(np.mean(fr.voiced[seg]))
    stv = fr.f0_st[seg]
    stv = stv[np.isfinite(stv)]
    rng = float(np.percentile(stv, 90) - np.percentile(stv, 10)) if len(stv) >= 5 else 99.0
    return vfrac >= fc["min_voiced"] and rng <= fc["max_f0_range_st"]


def repair_word_starts(spans: list[tuple[float, float]], gaps: list[Gap], fr: FrameFeatures, cfg: dict,
                       char_times: list[tuple] | None = None) -> None:
    """Split hesitation material that the aligner glued onto the start of the following word.

    A word whose span holds several sound runs separated by short silences is checked:
    a long, steady, flat-pitched first run is a filler; short runs that repeat the onset of
    the final run are a stutter. The word then starts at its final run.
    """
    fc, sc = cfg["detect"]["filler"], cfg["detect"]["stutter"]
    mf = cmvn(fr.mfcc)
    hop = fr.hop
    max_burst = int(round(sc["max_burst_s"] / hop))
    quiet = fr.quiet
    for k in range(1, len(spans)):
        s, e = spans[k]
        sl = fr.span(s, e)
        rs = merge_runs(runs(~quiet[sl], 3), 3)
        if len(rs) < 2 or (rs[-1][1] - rs[-1][0]) * hop < 0.06:
            continue
        gap = gaps[k - 1]
        a0, a1 = rs[0]
        seg = slice(sl.start + a0, sl.start + a1)
        first_len = (a1 - a0) * hop
        # the aligner put most letters of the word inside the first run: it is the word itself
        if char_times is not None and char_times[k]:
            t_first_end = float(fr.times[sl.start + a1 - 1] + hop)
            n_in = sum(1 for ct in char_times[k] if ct < t_first_end)
            if n_in >= max(2, 0.5 * len(char_times[k])):
                continue
        new_start = None
        la, lb = rs[-1]
        sims = [onset_similarity(mf, sl.start + ra, sl.start + rb, sl.start + la, sl.start + lb)
                for ra, rb in rs[:-1] if rb - ra <= max_burst]
        if len(sims) == len(rs) - 1 and min(sims) >= sc["min_similarity"]:
            # stutter: every earlier run repeats the onset of the word
            new_start = float(fr.times[sl.start + la])
            gap.leading_kind = "stutter"
            gap.leading_start = float(fr.times[sl.start + rs[0][0]])
            gap.leading_end = new_start
            gap.n_repeats = len(sims)
            gap.similarity = round(max(sims), 3)
        elif len(rs) == 2 and fc["min_s"] <= first_len <= fc["max_s"] and _flat_voiced(fr, seg, fc):
            new_start = float(fr.times[sl.start + rs[1][0]])
            gap.voiced_start, gap.voiced_end = float(fr.times[seg.start]), float(fr.times[seg.stop - 1] + hop)
            gap.voiced_s = max(gap.voiced_s, float(fr.voiced[seg].sum() * hop))
            gap.filler_like = True
            gap.leading_kind = "filler"
        if new_start is not None and e - new_start >= 0.06:
            spans[k] = (new_start, e)
            gap.end = new_start


def _robust_scale(v: np.ndarray) -> float:
    v = v[np.isfinite(v)]
    if len(v) < 3:
        return 1.0
    mad = np.median(np.abs(v - np.median(v))) * 1.4826
    return float(mad) if mad > 1e-6 else float(np.std(v) + 1e-6)


def build_take(tokens: list[Token], aligned: list[AlignedWord], fr: FrameFeatures, cfg: dict,
               duration: float) -> Take:
    pause_min = float(cfg["features"]["pause_min_s"])
    spans, gaps = refine_boundaries(aligned, fr, pause_min)
    repair_word_starts(spans, gaps, fr, cfg, [w.char_times for w in aligned])
    fc = cfg["detect"]["filler"]
    for g in gaps:
        if g.voiced_start is not None and not g.filler_like and g.voiced_end - g.voiced_start >= fc["min_s"]:
            g.filler_like = _flat_voiced(fr, fr.span(g.voiced_start, g.voiced_end), fc)
    st = fr.f0_st
    ir = fr.int_rel
    voiced = fr.voiced
    rows = []
    for tok, w, (s, e), in zip(tokens, aligned, spans):
        sl = fr.span(s, e)
        v = voiced[sl]
        stv = st[sl][v]
        n_frames = max(1, sl.stop - sl.start)
        row = dict(
            idx=tok.index, word=tok.display, norm=tok.norm, start=round(s, 4), end=round(e, 4),
            dur=max(0.02, e - s), n_syl=tok.n_syl, is_function=tok.is_function,
            sentence_end=tok.sentence_end, clause_end=tok.clause_end, align_score=w.score,
            voiced_ratio=float(v.sum()) / n_frames,
            f0_med_st=float(np.median(stv)) if len(stv) >= 3 else np.nan,
            f0_max_st=float(np.percentile(stv, 90)) if len(stv) >= 3 else np.nan,
            f0_range_st=float(np.percentile(stv, 90) - np.percentile(stv, 10)) if len(stv) >= 5 else np.nan,
            int_med_db=float(np.median(ir[sl])),
            int_max_db=float(np.max(ir[sl])),
            cpp_db=float(np.median(fr.cpp_db[sl][v])) if v.sum() >= 3 else np.nan,
            hnr_db=float(np.nanmedian(fr.hnr_db[sl][v])) if v.sum() >= 3 and np.isfinite(fr.hnr_db[sl][v]).any() else np.nan,
            tilt_db=float(np.median(fr.tilt_db[sl])),
            cent_oct=float(np.log2(np.median(fr.centroid_hz[sl]) / 1000.0 + 1e-6)),
        )
        if len(stv) >= 5:
            tt = fr.times[sl][v]
            row["f0_slope"] = float(np.polyfit(tt - tt.mean(), stv, 1)[0])
        else:
            row["f0_slope"] = np.nan
        rows.append(row)
    df = pd.DataFrame(rows)
    pause = [g.pause for g in gaps] + [np.nan]
    df["pause_after"] = pause
    df["gap_voiced_s"] = [g.voiced_s for g in gaps] + [0.0]
    df["nonspeech_after"] = [g.nonspeech for g in gaps] + [0.0]
    df["log_dur"] = np.log(df["dur"])
    df["rate"] = df["n_syl"] / df["dur"]

    # Prominence: how much a word stands out from its +/-2 neighbours in pitch, loudness and length.
    feats = {
        "f0": df["f0_max_st"].to_numpy(float),
        "int": df["int_max_db"].to_numpy(float),
        "dur": np.log(df["dur"].to_numpy(float) / df["n_syl"].to_numpy(float)),
    }
    zs = []
    for v in feats.values():
        scale = _robust_scale(v)
        z = np.full(len(v), np.nan)
        for i in range(len(v)):
            nb = [v[j] for j in range(max(0, i - 2), min(len(v), i + 3)) if j != i and np.isfinite(v[j])]
            if np.isfinite(v[i]) and nb:
                z[i] = (v[i] - np.median(nb)) / scale
        zs.append(z)
    df["prominence"] = np.nanmean(np.vstack(zs), axis=0)

    speech_time = float(df["dur"].sum())
    first, last = float(df["start"].iloc[0]), float(df["end"].iloc[-1])
    summary = dict(
        n_words=len(df), n_syl=int(df["n_syl"].sum()),
        articulation_rate=float(df["n_syl"].sum() / max(speech_time, 1e-3)),
        speech_rate=float(df["n_syl"].sum() / max(last - first, 1e-3)),
        total_pause_s=float(np.nansum(df["pause_after"])),
        n_pauses=int((df["pause_after"] > 0).sum()),
        f0_median_hz=fr.f0_median_hz, f0_floor=fr.f0_floor, f0_ceiling=fr.f0_ceiling,
        intensity_ref_db=fr.intensity_ref_db,
        f0_range_st=float(np.nanpercentile(fr.f0_st, 90) - np.nanpercentile(fr.f0_st, 10)) if fr.voiced.sum() > 20 else np.nan,
        speech_start=first, speech_end=last,
    )
    return Take(tokens=tokens, words=df, gaps=gaps, frames=fr, duration=duration, summary=summary, aligned=list(aligned))
