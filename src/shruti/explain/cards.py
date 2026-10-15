"""Flaw cards: deterministic, numbers-first explanations of every flagged region.

Every sentence is a template filled from stored measurements, so the same audio always
produces the same words. No language model is involved anywhere in this module.
"""
from __future__ import annotations

import math

from shruti.detect.core import Region
from shruti.features.word import Take

TITLES = {"rushed": "Rushed phrase", "dragged": "Dragged phrase", "long_pause": "Awkward long pause",
          "missing_pause": "Missing pause", "monotone": "Monotone stretch", "volume_fade": "Voice fades away",
          "mumble": "Mumbled words", "filler": "Filler sound", "stutter": "Repeated start (stutter)",
          "misplaced_emphasis": "Misplaced emphasis"}


def _words(P: Take, i: int, j: int) -> str:
    ws = [str(w).strip(".,;:!?\"'") for w in P.words["word"].iloc[i:j + 1]]
    return " ".join(ws)


def _fmt_p(p: float) -> str:
    return f"{p:.1e}" if p < 1e-3 else f"{p:.4f}"


def _math(r: Region, df: float, q_level: float) -> list[str]:
    t = r.strongest
    e = t.evidence
    zt = e.get("z_theoretical", t.z)
    lines = []
    if t.family == "tempo":
        lines.append(r"\ell = \ln\frac{D_\mathrm{obs}}{\theta\,D_\mathrm{ref}} = \ln\frac{%.2f\,\mathrm{s}}{%.2f\,\mathrm{s}} = %+.3f"
                     % (e["dur_obs"], e["dur_exp"], t.stat))
        lines.append(r"z = \ell/\sigma = %+.3f / %.3f = %+.2f" % (t.stat, e["sd"], zt))
    elif t.family == "pause":
        lines.append(r"\Delta = x - \theta\,m = %.2f - %.2f = %+.2f\,\mathrm{s}" % (e["pause_obs"], e["pause_exp"], t.stat))
        lines.append(r"z = \Delta/\sigma = %+.2f / %.2f = %+.2f" % (t.stat, e["sd"], zt))
    elif t.family == "level":
        lines.append(r"\bar d = \tfrac{1}{k}\sum_w (I_w - m_w - g) = %+.2f\,\mathrm{dB}" % t.stat)
        lines.append(r"z = \bar d/\sigma = %+.2f / %.2f = %+.2f" % (t.stat, e["sd"], zt))
    elif t.family == "monotone":
        lines.append(r"\ell = \ln\frac{R_\mathrm{obs}}{R_\mathrm{ref}} = \ln\frac{%.2f\,\mathrm{st}}{%.2f\,\mathrm{st}} = %+.3f"
                     % (e["range_obs_st"], e["range_exp_st"], t.stat))
        lines.append(r"z = \ell/\sigma = %+.3f / %.3f = %+.2f" % (t.stat, e["sd"], zt))
    elif t.family == "clarity":
        lines.append(r"c = \tfrac{1}{2}(z_\mathrm{tilt} + z_\mathrm{centroid}) = \tfrac{1}{2}(%+.2f %+.2f) = %+.2f"
                     % (e["tilt_z"], e["centroid_z"], t.stat))
        lines.append(r"z = c/\sigma_c = %+.2f" % zt)
    elif t.family == "emphasis":
        lines.append(r"\Delta I = %+.1f\,\mathrm{dB},\quad \Delta F_0 = %+.1f\,\mathrm{st}" % (e["db_delta"], e["st_delta"]))
        lines.append(r"z = (z_I + z_{F_0})/\sqrt{2+2\rho} = %+.2f" % zt)
    elif t.family == "fluency":
        lines.append(r"z = %+.2f\ \text{(%s detector)}" % (t.z, r.ftype))
    elif t.family == "encoder":
        lines.append(r"d = 1 - \cos(e_\mathrm{ref}, e_\mathrm{you}) = %.3f\ \text{(contrastive encoder)}" % e["distance"])
        lines.append(r"p = \Pr(d_\mathrm{null} \ge d) = %s\ \text{(empirical null of clean dev windows)}" % _fmt_p(t.p))
    if "z_theoretical" in e and (abs(e.get("mu0", 0.0)) > 1e-6 or abs(e.get("sigma0", 1.0) - 1.0) > 1e-6):
        lines.append(r"z_\mathrm{emp} = (z - \mu_0)/\sigma_0 = (%+.2f %+.2f)/%.2f = %+.2f\ \text{(empirical null)}"
                     % (e["z_theoretical"], -e["mu0"], e["sigma0"], t.z))
    if t.family not in ("fluency", "encoder"):
        lines.append(r"p = 2\,[1 - F_t(|z|;\ \nu = %d)] = %s" % (round(df), _fmt_p(t.p)))
    elif t.family == "fluency":
        lines.append(r"p = %s" % _fmt_p(t.p))
    lines.append(r"q_\mathrm{BH} = %s \le %.2f \;\Rightarrow\; \text{flagged}" % (_fmt_p(t.q), q_level))
    return lines


def card(r: Region, P: Take, df: float, q_level: float) -> dict:
    t = r.strongest
    e = t.evidence
    span_words = _words(P, r.i, r.j)
    word_i = _words(P, r.i, r.i)
    nxt = _words(P, r.j, r.j) if r.ftype in ("filler", "stutter") else ""
    evidence: list[dict] = []
    if t.family == "encoder":
        headline = f"“{span_words}” sounds unlike a good delivery ({TITLES[r.ftype].lower()})"
        explanation = (f"The contrastive delivery encoder places your delivery of these words "
                       f"{e['distance']:.2f} away from the reference (only {100 * t.p:.2g}% of clean deliveries are "
                       f"that far), and its type head reads it as {TITLES[r.ftype].lower()} "
                       f"(probability {e['type_prob']:.0%}).")
        fix = "Listen to the reference for this phrase, then use Ghost Coach to hear the difference in your voice."
        evidence = [{"feature": "Encoder distance", "unit": "cos", "yours": e["distance"], "expected": e["null_p95"]}]
    elif r.ftype in ("rushed", "dragged"):
        pct = abs(1 - e["dur_obs"] / e["dur_exp"]) * 100
        faster = r.ftype == "rushed"
        headline = f"“{span_words}” was {pct:.0f}% {'faster' if faster else 'slower'} than a good delivery"
        explanation = (f"These words took {e['dur_obs']:.2f} s of speaking time. At your own overall pace, the reference "
                       f"delivery takes {e['dur_exp']:.2f} s ({e['rate_obs']:.1f} vs {e['rate_exp']:.1f} syllables per "
                       f"second).")
        fix = (f"Slow this phrase down by about {pct:.0f}% and give each stressed syllable its full length."
               if faster else f"Tighten this phrase by about {100 * (1 - e['dur_exp'] / e['dur_obs']):.0f}% so it keeps moving.")
        evidence = [{"feature": "Speaking time", "unit": "s", "yours": e["dur_obs"], "expected": e["dur_exp"]},
                    {"feature": "Speech rate", "unit": "syll/s", "yours": e["rate_obs"], "expected": e["rate_exp"]}]
    elif r.ftype == "long_pause":
        headline = f"A {e['pause_obs']:.1f}-second pause after “{word_i}”"
        explanation = (f"You paused {e['pause_obs']:.2f} s after “{word_i}”. Good deliveries pause about "
                       f"{e['pause_exp']:.2f} s here, so the listener hears a broken thought rather than a dramatic beat.")
        fix = f"Cut this pause to about {max(e['pause_exp'], 0.2):.1f} s, or move it to the end of the clause."
        evidence = [{"feature": "Pause", "unit": "s", "yours": e["pause_obs"], "expected": e["pause_exp"]}]
    elif r.ftype == "missing_pause":
        headline = f"No pause after “{word_i}”"
        explanation = (f"Good deliveries hold a {e['pause_exp']:.2f}-second pause after “{word_i}” to let the idea "
                       f"land; you paused {e['pause_obs']:.2f} s and ran straight into the next words.")
        fix = f"Hold a pause of about {e['pause_exp']:.1f} s after “{word_i}”."
        evidence = [{"feature": "Pause", "unit": "s", "yours": e["pause_obs"], "expected": e["pause_exp"]}]
    elif r.ftype == "monotone":
        headline = f"Flat pitch across “{span_words}”"
        explanation = (f"Your pitch moved over {e['range_obs_st']:.1f} semitones here; the reference uses "
                       f"{e['range_exp_st']:.1f} semitones, so you used {100 * e['ratio']:.0f}% of the expected range.")
        fix = "Let your pitch rise on the most important word and fall at the end of the phrase."
        evidence = [{"feature": "Pitch range", "unit": "st", "yours": e["range_obs_st"], "expected": e["range_exp_st"]}]
    elif r.ftype == "volume_fade":
        headline = f"Your voice drops away on “{span_words}”"
        explanation = (f"Loudness fell {abs(e['db_drop']):.1f} dB below what your own level predicts for these words "
                       f"(compared word by word with the reference, after removing your overall volume).")
        fix = "Keep breath support to the end of the phrase: finish as strongly as you started."
        evidence = [{"feature": "Loudness change", "unit": "dB", "yours": e["db_drop"], "expected": 0.0}]
    elif r.ftype == "mumble":
        headline = f"“{span_words}” sounds muffled"
        explanation = ("High-frequency energy, which carries consonants, fell well below the reference "
                       f"(spectral tilt z = {e['tilt_z']:+.1f}, spectral centroid z = {e['centroid_z']:+.1f}). "
                       "Listeners hear this as mumbling.")
        fix = "Open your mouth more and finish every consonant crisply."
        evidence = [{"feature": "Spectral tilt", "unit": "z", "yours": e["tilt_z"], "expected": 0.0},
                    {"feature": "Spectral centroid", "unit": "z", "yours": e["centroid_z"], "expected": 0.0}]
    elif r.ftype == "filler":
        headline = f"Filler sound before “{nxt}”"
        explanation = (f"A {e['t_end'] - e['t_start']:.2f}-second voiced hesitation (“uh”/“um”) with almost "
                       f"flat pitch ({e['f0_range_st']:.1f} semitones of movement) sits where the reference has "
                       f"{e['ref_voiced_s']:.2f} s of voicing.")
        fix = "Replace the filler with a short silent pause; silence reads as confidence."
        evidence = [{"feature": "Hesitation sound", "unit": "s", "yours": e["voiced_s"], "expected": e["ref_voiced_s"]}]
    elif r.ftype == "stutter":
        n = int(e.get("n_repeats", 1))
        headline = f"The start of “{nxt}” repeats {n} time{'s' if n > 1 else ''}"
        explanation = (f"{n} short burst{'s' if n > 1 else ''} before “{nxt}” match the word's opening sound "
                       f"(frame-by-frame spectral similarity {e['similarity']:.2f}).")
        fix = f"Take a breath before “{nxt}” and start it once, slightly slower."
        evidence = [{"feature": "Repeated onsets", "unit": "count", "yours": n, "expected": 0}]
    else:  # misplaced_emphasis
        if e.get("kind") == "over":
            headline = f"Stress landed on “{word_i}”"
            explanation = (f"“{word_i}” came out {e['db_delta']:+.1f} dB louder and {e['st_delta']:+.1f} semitones "
                           f"higher than in the reference, where it is a light word. The emphasis belongs on the "
                           f"content word next to it.")
            fix = f"Keep “{word_i}” light and put the stress on the key word of the phrase."
        else:
            headline = f"“{word_i}” lost its emphasis"
            explanation = (f"The reference stresses “{word_i}”; yours was {e['db_delta']:+.1f} dB and "
                           f"{e['st_delta']:+.1f} semitones relative to it.")
            fix = f"Lean into “{word_i}”: a little louder, a little higher, a little longer."
        evidence = [{"feature": "Loudness peak", "unit": "dB", "yours": e["db_delta"], "expected": 0.0},
                    {"feature": "Pitch peak", "unit": "st", "yours": e["st_delta"], "expected": 0.0}]
    for ev in evidence:
        for k in ("yours", "expected"):
            v = ev[k]
            ev[k] = None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), 3)
    return {
        "id": r.region_id, "type": r.ftype, "title": TITLES[r.ftype], "dimension": r.dimension,
        "severity": r.severity, "t_start": r.t_start, "t_end": r.t_end,
        "ci_start": r.ci_start, "ci_end": r.ci_end, "confidence": r.confidence,
        "word_span": [r.i, r.j], "words": span_words if r.ftype not in ("filler", "stutter") else nxt,
        "headline": headline, "explanation": explanation, "fix": fix, "evidence": evidence,
        "stats": {"z": round(t.z, 3), "p": float(t.p), "q": float(t.q), "family": t.family,
                  "window_words": t.j - t.i + 1},
        "math": _math(r, df, q_level),
    }
