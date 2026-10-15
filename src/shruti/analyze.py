"""End-to-end analysis of one delivery: the single entry point used by the API, CLI and tests."""
from __future__ import annotations

import hashlib
import json
import math
import subprocess
from functools import lru_cache

import numpy as np

from shruti import __version__
from shruti.config import ROOT, config_hash, load_config
from shruti.detect.bootstrap import bootstrap_regions
from shruti.detect.core import DIMENSIONS, detect
from shruti.explain.cards import card
from shruti.io.audio import SR, sha256_array
from shruti.process import load_scripts
from shruti.rubric.score import score, style_notes
from shruti.store import get_baseline, processed_take, single_reference_baseline


@lru_cache(maxsize=1)
def code_version() -> str:
    try:
        sha = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True,
                             text=True, timeout=3).stdout.strip()
    except Exception:  # pragma: no cover
        sha = ""
    return f"{__version__}+{sha}" if sha else __version__


def _clean(v):
    if isinstance(v, (float, np.floating)):
        return None if not math.isfinite(float(v)) else round(float(v), 4)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    return v


def _word_rows(P, B, g) -> list[dict]:
    tempo = math.exp(g.get("tempo", 0.0))
    rows = []
    for i, w in P.words.iterrows():
        def ref(feat, offset=0.0):
            return {"m": float(B.loc[feat][i] + offset), "sd": float(B.scale[feat][i])}
        rows.append({
            "i": int(w["idx"]), "word": w["word"], "start": float(w["start"]), "end": float(w["end"]),
            "n_syl": int(w["n_syl"]), "pause_after": float(w["pause_after"]) if np.isfinite(w["pause_after"]) else None,
            "f0_med_st": w["f0_med_st"], "int_med_db": w["int_med_db"], "rate": w["rate"],
            "prominence": w["prom_pi"] if "prom_pi" in w else w["prominence"],
            "ref": {"f0_med_st": ref("f0_med_st", g.get("f0_med_st", 0.0)),
                    "int_med_db": ref("int_med_db", g.get("int_med_db", 0.0)),
                    "dur": float(np.exp(B.loc["log_dur"][i]) * tempo),
                    "pause_after": float(B.loc["pause_after"][i] * tempo) if np.isfinite(B.loc["pause_after"][i]) else None},
        })
    return rows


def analyze(x: np.ndarray, script_id: str | None = None, transcript: str | None = None,
            ref_audio: np.ndarray | None = None, cfg: dict | None = None, bootstrap: bool = True,
            exclude_speaker: str | None = None) -> dict:
    cfg = cfg or load_config()
    scripts = load_scripts()
    if script_id:
        if script_id not in scripts:
            raise KeyError(f"unknown script {script_id}")
        transcript = scripts[script_id]["transcript"]
        B = get_baseline(script_id, cfg, exclude_speaker=exclude_speaker)
        mode = "population" if B.n_refs > 1 else "single-reference (bench original)"
    elif ref_audio is not None and transcript:
        B = single_reference_baseline(ref_audio, transcript, cfg)
        mode = "single-reference (uploaded)"
    else:
        raise ValueError("give a script_id, or a transcript together with a reference recording")
    P, report = processed_take(x, transcript, cfg)
    regions, tests, g = detect(P, B, cfg)
    if bootstrap:
        bootstrap_regions(P, B, regions, cfg)
    style = style_notes(g, P.summary, [t.summary for t in B.takes])
    speaking = P.summary["speech_end"] - P.summary["speech_start"]
    rub = score(regions, speaking, style, cfg)
    cards = [card(r, P, B.df, cfg["detect"]["fdr_q"]) for r in regions]
    audio_hash = sha256_array(x)
    cfg_h = config_hash(cfg)
    fp_parts = {"audio_sha256": audio_hash, "config": cfg_h, "model": cfg["alignment"]["model"],
                "code": code_version(), "baseline": ",".join(B.ref_ids)}
    fingerprint = hashlib.sha256(json.dumps(fp_parts, sort_keys=True).encode()).hexdigest()[:16]
    ref_take = B.takes[0]
    result = {
        "analysis_id": fingerprint,
        "version": code_version(),
        "mode": mode,
        "script": {"script_id": script_id, "title": scripts[script_id]["title"] if script_id else "Custom script",
                   "speaker": scripts[script_id]["speaker"] if script_id else None, "transcript": transcript},
        "duration_s": len(x) / SR,
        "quality": report,
        "summary": P.summary,
        "style": style,
        "rubric": rub,
        "cards": cards,
        "words": _word_rows(P, B, g),
        "lanes": P.frames.to_lanes(step=2),
        "reference": {"ref_ids": B.ref_ids, "n_refs": B.n_refs,
                      "word_spans": [[float(s), float(e)] for s, e in zip(ref_take.words["start"], ref_take.words["end"])],
                      "duration_s": ref_take.duration},
        "tests": {"n_tests": len(tests), "n_rejected": int(sum(t.reject for t in tests)),
                  "n_flagged": len(regions), "fdr_q": cfg["detect"]["fdr_q"], "df": B.df,
                  "by_family": {f: sum(1 for t in tests if t.family == f) for f in sorted({t.family for t in tests})}},
        "dimensions": DIMENSIONS,
        "fingerprint": {"id": fingerprint, **fp_parts},
    }
    return _clean(result)
