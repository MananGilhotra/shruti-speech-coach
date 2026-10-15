"""Turn (audio, transcript) into a Take: forced alignment + frame features + word table."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from shruti.align.ctc import Aligner
from shruti.config import SCRIPTS_DIR, load_config
from shruti.features.frame import extract_frames
from shruti.features.word import Take, build_take
from shruti.io.audio import SR
from shruti.text.words import normalize_for_wer, tokenize, word_error_rate


class QualityError(ValueError):
    """The recording cannot be analysed reliably (too short, silent, off-script)."""


@lru_cache(maxsize=1)
def load_scripts() -> dict[str, dict]:
    path = SCRIPTS_DIR / "scripts.json"
    if not path.exists():
        return {}
    return {s["script_id"]: s for s in json.loads(path.read_text(encoding="utf-8"))}


def get_aligner(cfg: dict) -> Aligner:
    a = cfg["alignment"]
    return Aligner.get(a["model"], a.get("device", "cpu"))


def quality_gate(x: np.ndarray, transcript: str, cfg: dict, aligner: Aligner, log_probs: np.ndarray) -> dict:
    dur = len(x) / SR
    if dur < 2.0:
        raise QualityError(f"Recording is only {dur:.1f} s long; at least 2 s of speech is needed.")
    if dur > cfg["audio"]["max_seconds"]:
        raise QualityError(f"Recording is {dur:.0f} s long; the limit is {cfg['audio']['max_seconds']} s.")
    peak = float(np.max(np.abs(x)))
    if peak < 1e-3:
        raise QualityError("The recording is silent.")
    clipped = float(np.mean(np.abs(x) > 0.999))
    hyp = [w for w, _, _ in aligner.transcribe(x, log_probs)]
    wer = word_error_rate(normalize_for_wer(transcript), hyp)
    report = {"duration_s": round(dur, 2), "clipped_fraction": round(clipped, 5), "asr_wer": round(wer, 3),
              "asr_words": len(hyp)}
    if wer > cfg["alignment"]["max_wer"]:
        report["warning"] = (f"The speech recogniser heard something quite different from the script "
                             f"(WER {wer:.0%}). Results may be unreliable.")
    return report


def process(x: np.ndarray, transcript: str, cfg: dict | None = None, strict: bool = False) -> tuple[Take, dict]:
    """Align and measure one recording. Returns the Take and a quality report."""
    cfg = cfg or load_config()
    tokens = tokenize(transcript)
    if len(tokens) < 3:
        raise QualityError("The transcript needs at least three words.")
    aligner = get_aligner(cfg)
    log_probs = aligner.emissions(x, chunk_s=cfg["alignment"]["chunk_seconds"])
    report = quality_gate(x, transcript, cfg, aligner, log_probs)
    if strict and "warning" in report:
        raise QualityError(report["warning"])
    aligned = aligner.align(x, tokens, log_probs)
    frames = extract_frames(x, SR, cfg)
    take = build_take(tokens, aligned, frames, cfg, duration=len(x) / SR)
    return take, report


def take_to_json(take: Take) -> dict:
    df = take.words.replace({np.nan: None})
    return {
        "words": df.to_dict(orient="records"),
        "gaps": [g.__dict__ for g in take.gaps],
        "summary": {k: (None if isinstance(v, float) and not np.isfinite(v) else v) for k, v in take.summary.items()},
    }


def save_take(take: Take, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(take_to_json(take), indent=1, default=float))
