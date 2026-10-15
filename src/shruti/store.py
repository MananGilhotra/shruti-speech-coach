"""Caches for processed takes and population baselines.

Processing a take (alignment + features) costs a few seconds, so processed takes are
pickled under results/cache/takes, keyed by the audio hash, transcript and config hash.
"""
from __future__ import annotations

import hashlib
import json
import pickle
import threading
from pathlib import Path

import numpy as np

from shruti.baseline.population import Baseline, build_baseline
from shruti.config import DATA_DIR, RESULTS_DIR, config_hash, load_config
from shruti.features.word import Take
from shruti.io.audio import load_audio, sha256_array
from shruti.process import load_scripts, process

TAKE_CACHE = RESULTS_DIR / "cache" / "takes"
ORIGINALS_DIR = DATA_DIR / "bench" / "originals"
STUDIO_ACCEPTED = DATA_DIR / "studio" / "accepted"
_lock = threading.Lock()
_baselines: dict[tuple, Baseline] = {}


def _key(audio_hash: str, transcript: str, cfg: dict) -> str:
    # only the settings that change alignment/features/word edges; detection settings can be tuned freely
    sub = {k: cfg[k] for k in ("audio", "alignment", "features")}
    sub["edges"] = {k: cfg["detect"][k] for k in ("filler", "stutter")}
    blob = audio_hash + "|" + transcript + "|" + config_hash(sub)
    return hashlib.sha256(blob.encode()).hexdigest()[:24]


def processed_take(x: np.ndarray, transcript: str, cfg: dict | None = None, use_cache: bool = True) -> tuple[Take, dict]:
    cfg = cfg or load_config()
    key = _key(sha256_array(x), transcript, cfg)
    path = TAKE_CACHE / f"{key}.pkl"
    if use_cache and path.exists():
        with open(path, "rb") as f:
            return pickle.load(f)
    take, report = process(x, transcript, cfg)
    if use_cache:
        TAKE_CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "wb") as f:
            pickle.dump((take, report), f)
        tmp.replace(path)
    return take, report


def reference_files(script_id: str) -> list[tuple[str, Path]]:
    """Reference recordings for a script: the original orator plus accepted human good takes."""
    refs = []
    orig = ORIGINALS_DIR / f"{script_id}.flac"
    if orig.exists():
        refs.append((f"{script_id}_original", orig))
    acc = STUDIO_ACCEPTED / script_id
    if acc.exists():
        for p in sorted(acc.glob("*.flac")) + sorted(acc.glob("*.wav")):
            refs.append((p.stem, p))
    return refs


def get_baseline(script_id: str, cfg: dict | None = None, exclude_speaker: str | None = None,
                 only_original: bool = False) -> Baseline:
    """Population baseline for a bench script (leave-speaker-out when exclude_speaker is given)."""
    cfg = cfg or load_config()
    scripts = load_scripts()
    if script_id not in scripts:
        raise KeyError(f"unknown script {script_id}")
    refs = reference_files(script_id)
    if only_original:
        refs = refs[:1]
    if exclude_speaker:
        refs = [r for r in refs if exclude_speaker not in r[0]] or refs[:1]
    key = (script_id, tuple(r[0] for r in refs), config_hash(cfg))
    with _lock:
        if key in _baselines:
            return _baselines[key]
    if not refs:
        raise FileNotFoundError(f"no reference recording for {script_id}; run `shruti build-originals`")
    takes = [processed_take(load_audio(p), scripts[script_id]["transcript"], cfg)[0] for _, p in refs]
    B = build_baseline(script_id, takes, [r[0] for r in refs], cfg)
    with _lock:
        _baselines[key] = B
    return B


def single_reference_baseline(ref_audio: np.ndarray, transcript: str, cfg: dict | None = None) -> Baseline:
    cfg = cfg or load_config()
    take, _ = processed_take(ref_audio, transcript, cfg)
    return build_baseline("custom", [take], ["uploaded_reference"], cfg)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, default=float))
