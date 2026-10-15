"""The "bad mirror": inject labelled delivery flaws into a good take.

A render is a pure function of (recipe, source take). Recipes are small JSON objects, so
the released dataset ships recipes plus a generator instead of gigabytes of audio, and
`make dataset` regenerates the audio bit-for-bit (SHA-256 checked).

Order of operations for one render:
  1. one PSOLA pass for every timing and pitch change (nuisance + flaws), in source time
  2. in-place sample edits in rendered time (gain curves, mumbling)
  3. insertions/deletions (pauses, fillers, stutters), latest position first
  4. voice change and global gain (nuisance), then an optional stress condition
Labels are carried through every step with explicit time maps.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from shruti import dsp
from shruti.dsp import SR, TimeMap
from shruti.features.word import Take

FLAW_TYPES = ["rushed", "dragged", "long_pause", "missing_pause", "monotone", "volume_fade", "mumble",
              "filler", "stutter", "misplaced_emphasis"]

LADDER_DEFAULT = {
    "rushed": [1.08, 1.8], "dragged": [1.10, 2.0], "long_pause": [0.30, 3.0], "missing_pause": [0.80, 0.02],
    "monotone": [0.80, 0.10], "volume_fade": [2.0, 18.0], "mumble": [6000.0, 1500.0],
    "filler": [0.20, 0.80], "stutter": [1.0, 3.0], "misplaced_emphasis": [1.0, 10.0],
}


def ladder_param(ftype: str, level: int, ladder: dict | None = None) -> float:
    lo, hi = (ladder or LADDER_DEFAULT)[ftype]
    if level <= 0:
        return float("nan")
    v = lo * (hi / lo) ** ((level - 1) / 9.0)
    return float(round(v)) if ftype == "stutter" else float(v)


@dataclass
class Rendered:
    audio: np.ndarray
    labels: list[dict]
    word_spans: list[tuple[float, float]]
    duration: float


# --------------------------------------------------------------------------- helpers
def _word_spans(take: Take) -> list[tuple[float, float]]:
    return list(zip(take.words["start"].astype(float), take.words["end"].astype(float)))


def _apply_factor(grid: np.ndarray, f: np.ndarray, a: float, b: float, factor: float, ramp: float = 0.01) -> None:
    if b - a < 2 * ramp + 0.01:
        ramp = max(0.0, (b - a) / 4)
    w = np.interp(grid, [a - 1e-9, a, a + ramp, b - ramp, b, b + 1e-9], [0, 0, 1, 1, 0, 0])
    f *= 1.0 + (factor - 1.0) * w


def _filler_sound(src: Take, x: np.ndarray, d: float, rng: np.random.Generator) -> np.ndarray:
    """A hesitation vowel ("uhh") made from the speaker's own voice: a stable vowel stretched to d seconds."""
    fr = src.frames
    good = fr.voiced & (fr.int_rel > -4.0)
    best = (0, 0)
    for i, w in src.words.iterrows():
        if w["is_function"] or w["dur"] < 0.15:
            continue
        sl = fr.span(w["start"], w["end"])
        run_start, prev = None, False
        for k in range(sl.start, sl.stop + 1):
            cur = bool(good[k]) if k < sl.stop else False
            if cur and not prev:
                run_start = k
            if not cur and prev and run_start is not None and k - run_start > best[1] - best[0]:
                best = (run_start, k)
            prev = cur
    if best[1] - best[0] < 6:
        a, b = int(0.3 * len(x)), int(0.3 * len(x)) + 1600
    else:
        mid = (best[0] + best[1]) // 2
        half = min(5, (best[1] - best[0]) // 2)
        a, b = int((mid - half) * fr.hop * SR), int((mid + half) * fr.hop * SR)
    y = x[a:b]
    f0 = fr.f0_median_hz * 2 ** (-1 / 12)

    def flat(ts, hz):
        frac = (ts - ts.min()) / max(ts.max() - ts.min(), 1e-6)
        return np.full_like(hz, f0) * 2 ** (-1.5 * frac / 12)

    # Praat's overlap-add caps one stretch at about 3x, so lengthen in stages
    for _ in range(6):
        need = d / max(len(y) / SR, 1e-3)
        if abs(need - 1.0) < 0.02:
            break
        step = float(np.clip(need, 0.4, 2.8))
        y, _ = dsp.psola(y, fr.f0_floor, fr.f0_ceiling, [(0.0, step), (len(y) / SR, step)], flat)
    return dsp.fade(y * 0.85, 0.03)


def _key_word_near(src: Take, i: int) -> int | None:
    w = src.words
    best, best_p = None, 0.8
    for k in range(max(0, i - 4), min(len(w), i + 5)):
        if k == i or w["is_function"].iloc[k]:
            continue
        p = w["prominence"].iloc[k]
        if np.isfinite(p) and p > best_p:
            best, best_p = k, p
    return best


# --------------------------------------------------------------------------- render
def render(recipe: dict, src: Take, x: np.ndarray, ladder: dict | None = None) -> Rendered:
    rng = np.random.default_rng(int(recipe.get("seed", 0)))
    nz = recipe.get("nuisance") or {}
    flaws = sorted(recipe.get("flaws", []), key=lambda f: f["words"][0])
    spans = _word_spans(src)
    fr = src.frames
    total = len(x) / SR

    # ---- 1. timing + pitch in one PSOLA pass ---------------------------------------
    grid = np.arange(0.0, total + 0.005, 0.005)
    f = np.full(len(grid), float(nz.get("tempo", 1.0)))
    if nz.get("jitter_sd"):
        for a, b in spans:
            _apply_factor(grid, f, a, b, math.exp(rng.normal(0, nz["jitter_sd"])))
    pitch_ops = []
    for fl in flaws:
        t, i, j = fl["type"], fl["words"][0], fl["words"][-1]
        lvl_p = fl["param"]
        if t in ("rushed", "dragged"):
            # speaking faster/slower changes every sound in the phrase; true pauses keep their length
            factor = 1.0 / lvl_p if t == "rushed" else lvl_p
            cuts = [(src.gaps[k].silence_start, src.gaps[k].silence_end) for k in range(i, j)
                    if src.gaps[k].silence_start is not None]
            a = spans[i][0]
            for c0, c1 in cuts + [(spans[j][1], spans[j][1])]:
                if c0 - a > 0.03:
                    _apply_factor(grid, f, a, c0, factor)
                a = c1
        elif t == "monotone":
            pitch_ops.append(("compress", spans[i][0], spans[j][1], lvl_p))
        elif t == "misplaced_emphasis":
            g = lvl_p
            _apply_factor(grid, f, spans[i][0], spans[i][1], 1.0 + 0.02 * g)
            pitch_ops.append(("bump", spans[i][0], spans[i][1], 0.6 * g))
            key = fl.get("key_word")
            if key is not None:
                pitch_ops.append(("compress", spans[key][0], spans[key][1], max(0.3, 1 - 0.05 * g)))
    shift = float(nz.get("pitch_shift_st", 0.0))
    prange = float(nz.get("pitch_range", 1.0))
    f0m = fr.f0_median_hz

    def pitch_fn(ts, hz):
        st = 12 * np.log2(hz / f0m)
        st = st * prange + shift
        for op, a, b, v in pitch_ops:
            m = (ts >= a) & (ts <= b)
            if not m.any():
                continue
            if op == "compress":
                mean = st[m].mean()
                st[m] = mean + v * (st[m] - mean)
            else:  # raised-cosine bump of v semitones over the word
                ph = (ts[m] - a) / max(b - a, 1e-3)
                st[m] = st[m] + v * np.sin(np.pi * ph) ** 0.5
        return f0m * 2 ** (st / 12)

    dur_pts = dsp.compress_points(grid, f)
    needs_pitch = bool(pitch_ops) or shift != 0.0 or prange != 1.0
    y, tm = dsp.psola(x, fr.f0_floor, fr.f0_ceiling, dur_pts, pitch_fn if needs_pitch else None)

    def rspan(k: int, tmap: TimeMap) -> tuple[float, float]:
        return float(tmap(spans[k][0])), float(tmap(spans[k][1] - 1e-6))

    # ---- 2. in-place edits ------------------------------------------------------------
    gains = []
    for fl in flaws:
        t, i, j = fl["type"], fl["words"][0], fl["words"][-1]
        a, b = rspan(i, tm)[0], rspan(j, tm)[1]
        if t == "volume_fade":
            depth = fl["param"]
            curve = np.concatenate([np.linspace(0, -depth, 20), np.full(80, -depth)])
            gains.append((a, b, curve))
        elif t == "misplaced_emphasis":
            gains.append((a, b, fl["param"]))
            key = fl.get("key_word")
            if key is not None:
                ka, kb = rspan(key, tm)
                gains.append((ka, kb, -0.5 * fl["param"]))
        elif t == "mumble":
            cutoff = fl["param"]
            ia, ib = int(a * SR), int(b * SR)
            seg_rms = float(np.sqrt(np.mean(y[ia:ib] ** 2)) + 1e-6)
            noise = dsp.bandpass_noise(len(y), 800, 3500, rng) * 0.0
            nseg = dsp.bandpass_noise(ib - ia, 800, 3500, rng)
            noise[ia:ib] = nseg / (np.sqrt(np.mean(nseg ** 2)) + 1e-9) * seg_rms * 10 ** (-24 / 20)
            new = dsp.lowpass(y, cutoff) * 10 ** (-3 / 20) + noise
            y = dsp.crossfade_replace(y, a, b, new)
    if gains:
        y = y * dsp.gain_envelope(len(y), gains)

    # ---- 3. insertions and deletions (latest position first) --------------------------
    ops = []
    for fl in flaws:
        t, i = fl["type"], fl["words"][0]
        if t in ("long_pause", "missing_pause"):
            ops.append((spans[i][1], fl))
        elif t in ("filler", "stutter"):
            ops.append((spans[i][0], fl))
    ops.sort(key=lambda o: -o[0])
    inserted: dict[str, list[float]] = {}
    for _, fl in ops:
        t, i = fl["type"], fl["words"][0]
        if t == "long_pause":
            e_i, s_n = float(tm(spans[i][1])), float(tm(spans[i + 1][0]))
            pos = 0.5 * (e_i + s_n) if s_n > e_i else e_i
            seg = dsp.room_tone(x, fr.silent, fr.hop, fl["param"], rng)
            y = dsp.insert(y, pos, seg)
            op = TimeMap.insertion(pos, len(seg) / SR)
        elif t == "missing_pause":
            gap = src.gaps[i]
            if gap.silence_start is None:
                continue
            s0, s1 = float(tm(gap.silence_start)), float(tm(gap.silence_end))
            keep = max(0.04, fl["param"] * (s1 - s0))
            cut = (s1 - s0) - keep
            if cut <= 0.02:
                continue
            a = s0 + keep / 2
            y = dsp.delete(y, a, a + cut)
            op = TimeMap.deletion(a, a + cut)
        elif t == "filler":
            ws = float(tm(spans[i][0]))
            prev_e = float(tm(spans[i - 1][1])) if i > 0 else ws
            pos = 0.5 * (prev_e + ws) if ws - prev_e > 0.1 else ws
            pad = dsp.room_tone(x, fr.silent, fr.hop, 0.08, rng)
            fill = _filler_sound(src, x, fl["param"], rng)
            seg = np.concatenate([pad, fill, pad])
            y = dsp.insert(y, pos, seg)
            op = TimeMap.insertion(pos, len(seg) / SR)
            inserted[fl["flaw_id"]] = [pos + len(pad) / SR, pos + (len(pad) + len(fill)) / SR]
        elif t == "stutter":
            ws, we = rspan(i, tm)
            n_on = int(min(0.12, 0.45 * (we - ws)) * SR)
            onset = dsp.fade(y[int(ws * SR): int(ws * SR) + n_on].copy(), 0.008)
            parts = []
            for _ in range(int(fl["param"])):
                parts += [onset, dsp.room_tone(x, fr.silent, fr.hop, float(rng.uniform(0.07, 0.13)), rng)]
            seg = np.concatenate(parts)
            y = dsp.insert(y, ws, seg, edge_fade_s=0.002)
            op = TimeMap.insertion(ws, len(seg) / SR)
            inserted[fl["flaw_id"]] = [ws, ws + len(seg) / SR]
        else:
            continue
        for k, (ia, ib) in list(inserted.items()):
            if fl.get("flaw_id") != k:
                inserted[k] = [float(op(ia)), float(op(ib - 1e-6))]
        tm = tm.then(op)

    # ---- 4. nuisance voice/gain, stress condition --------------------------------------
    if nz.get("formant_ratio") and abs(nz["formant_ratio"] - 1.0) > 1e-3:
        y = dsp.change_voice(y, fr.f0_floor, fr.f0_ceiling, nz["formant_ratio"], 0.0)
    if nz.get("gain_db"):
        y = y * 10 ** (nz["gain_db"] / 20)
    cond = recipe.get("condition")
    if cond:
        from shruti.stress.conditions import apply_condition
        y = apply_condition(y, cond, rng)
    peak = float(np.max(np.abs(y)))
    if peak > 0.98:
        y = y * (0.98 / peak)

    # ---- labels ------------------------------------------------------------------------
    final_spans = [rspan(k, tm) for k in range(len(spans))]
    labels = []
    for fl in flaws:
        t, i, j = fl["type"], fl["words"][0], fl["words"][-1]
        if t in ("rushed", "dragged", "monotone", "volume_fade", "mumble", "misplaced_emphasis"):
            ts, te = final_spans[i][0], final_spans[j][1]
        elif t == "long_pause":
            ts, te = final_spans[i][1], final_spans[i + 1][0]
        elif t == "missing_pause":
            c = 0.5 * (final_spans[i][1] + final_spans[i + 1][0])
            ts, te = c - 0.25, c + 0.25
        elif t in ("filler", "stutter"):
            if fl["flaw_id"] not in inserted:
                continue
            ts, te = inserted[fl["flaw_id"]]
            if t == "stutter":
                te = final_spans[i][0]
        else:
            continue
        labels.append({"flaw_id": fl["flaw_id"], "type": t, "level": fl["level"], "param": fl["param"],
                       "words": [i, j], "t_start": round(ts, 4), "t_end": round(te, 4),
                       "t_start_source": round(spans[i][0], 4), "t_end_source": round(spans[j][1], 4)})
    return Rendered(audio=y.astype(np.float32), labels=labels, word_spans=final_spans, duration=len(y) / SR)


# --------------------------------------------------------------------------- site choice
def choose_site(src: Take, ftype: str, rng: np.random.Generator, span_words=(3, 6),
                taken: list[tuple[int, int]] | None = None) -> dict | None:
    """Pick where a flaw goes. Returns {'words': [i, j], ...} or None if no valid site."""
    w = src.words
    W = len(w)
    taken = taken or []

    def free(i, j):
        return all(j < a - 1 or i > b + 1 for a, b in taken)

    for _ in range(200):
        if ftype in ("rushed", "dragged", "monotone", "volume_fade", "mumble"):
            k = int(rng.integers(span_words[0], span_words[1] + 1))
            i = int(rng.integers(1, max(2, W - k - 1)))
            j = min(W - 2, i + k - 1)
            if w["end"].iloc[j] - w["start"].iloc[i] < 0.8 or not free(i, j):
                continue
            if ftype == "monotone" and np.nansum(np.isfinite(w["f0_med_st"].iloc[i:j + 1])) < 3:
                continue
            return {"words": [i, j]}
        if ftype == "long_pause":
            i = int(rng.integers(1, W - 2))
            if w["pause_after"].iloc[i] < 0.3 and free(i, i + 1):
                return {"words": [i, i]}
            continue
        if ftype == "missing_pause":
            cands = [i for i in range(W - 1) if w["pause_after"].iloc[i] >= 0.35 and src.gaps[i].silence_start
                     is not None and free(i, i + 1)]
            if not cands:
                return None
            i = int(cands[int(rng.integers(len(cands)))])
            return {"words": [i, i]}
        if ftype in ("filler", "stutter"):
            i = int(rng.integers(1, W - 1))
            if w["is_function"].iloc[i] or w["dur"].iloc[i] < 0.2 or not free(i - 1, i):
                continue
            return {"words": [i, i]}
        if ftype == "misplaced_emphasis":
            i = int(rng.integers(1, W - 1))
            p = w["prominence"].iloc[i]
            if not (w["is_function"].iloc[i] and w["dur"].iloc[i] >= 0.08 and np.isfinite(p) and p < 0.3):
                continue
            key = _key_word_near(src, i)
            if key is None or not free(min(i, key), max(i, key)):
                continue
            return {"words": [i, i], "key_word": key}
    return None


def make_flaw(src: Take, ftype: str, level: int, rng: np.random.Generator, flaw_id: str,
              taken: list[tuple[int, int]], ladder: dict | None = None) -> list[dict]:
    """One or more flaw entries for a recipe (fillers multiply with level)."""
    param = ladder_param(ftype, level, ladder)
    count = 1 + (level - 1) // 3 if ftype == "filler" else 1
    out = []
    for n in range(count):
        site = choose_site(src, ftype, rng, taken=taken)
        if site is None:
            break
        fl = {"flaw_id": f"{flaw_id}{'' if count == 1 else chr(97 + n)}", "type": ftype, "level": level,
              "param": round(param, 4), **site}
        a, b = fl["words"][0], fl["words"][-1]
        if "key_word" in fl:
            a, b = min(a, fl["key_word"]), max(b, fl["key_word"])
        taken.append((a, b))
        out.append(fl)
    return out


def sample_nuisance(rng: np.random.Generator, cfg_n: dict, voice: bool = True) -> dict:
    u = lambda lo_hi: float(rng.uniform(*lo_hi))  # noqa: E731
    nz = {"tempo": round(u(cfg_n["tempo"]), 4), "jitter_sd": cfg_n["word_jitter_sd"],
          "pitch_shift_st": round(u(cfg_n["pitch_shift_st"]), 3), "pitch_range": round(u(cfg_n["pitch_range"]), 3),
          "gain_db": round(u(cfg_n["gain_db"]), 2)}
    if voice:
        nz["formant_ratio"] = round(u(cfg_n["formant_ratio"]), 3)
    return nz
