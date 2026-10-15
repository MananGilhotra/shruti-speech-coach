"""Cut the reference excerpts out of the downloaded public-domain recordings.

The excerpt window in scripts.json is approximate; we snap both edges to the nearest
silence so no word is clipped and no neighbouring applause or speech leaks in.
"""
from __future__ import annotations

import json

import numpy as np

from shruti.config import DATA_DIR, load_config
from shruti.features.frame import extract_frames
from shruti.io.audio import SR, load_audio, peak_normalize, save_audio, sha256_file
from shruti.process import load_scripts, process
from shruti.store import ORIGINALS_DIR

RAW_DIR = DATA_DIR / "raw"


def _snap_edges(x: np.ndarray, w0: float, w1: float, margin: float, cfg: dict) -> tuple[float, float]:
    """Move the window start back / end forward to the closest silence (>= 0.2 s) within `margin`."""
    a = max(0.0, w0 - margin)
    seg = x[int(a * SR): int((w1 + margin) * SR)]
    fr = extract_frames(seg, SR, cfg)
    sil = fr.silent
    hop = fr.hop
    runs, start = [], None
    for i, s in enumerate(np.append(sil, False)):
        if s and start is None:
            start = i
        elif not s and start is not None:
            if (i - start) * hop >= 0.2:
                runs.append((a + start * hop, a + i * hop))
            start = None
    rel0, rel1 = w0, w1
    before = [r for r in runs if r[1] <= w0 + 0.3]
    if before:
        rel0 = max(before[-1][1] - 0.25, before[-1][0])
    after = [r for r in runs if r[0] >= w1 - 0.3]
    if after:
        rel1 = min(after[0][0] + 0.35, after[0][1])
    return rel0, rel1


def build_originals(force: bool = False) -> list[dict]:
    cfg = load_config()
    ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)
    out = []
    for sid, s in load_scripts().items():
        dst = ORIGINALS_DIR / f"{sid}.flac"
        meta_path = ORIGINALS_DIR / f"{sid}.json"
        if dst.exists() and meta_path.exists() and not force:
            out.append(json.loads(meta_path.read_text()))
            continue
        src = RAW_DIR / s["source"]["file"]
        if not src.exists():
            raise FileNotFoundError(f"{src} missing: run `make data` to download the public-domain sources")
        full = load_audio(src)
        w0, w1 = s["window"]
        t0, t1 = _snap_edges(full, w0, w1, 1.2, cfg)
        x = peak_normalize(full[int(t0 * SR): int(t1 * SR)], cfg["audio"]["peak_dbfs"])
        take, report = process(x, s["transcript"], cfg)
        save_audio(dst, x)
        meta = {"script_id": sid, "speaker": s["speaker"], "year": s["year"], "excerpt_s": [round(t0, 3), round(t1, 3)],
                "duration_s": round(len(x) / SR, 3), "n_words": len(take.words), "asr_wer": report["asr_wer"],
                "sha256": sha256_file(dst), "source_sha256": s["source"]["sha256"],
                "license": s["source"]["license"], "commons_page": s["source"]["commons_page"]}
        meta_path.write_text(json.dumps(meta, indent=1))
        out.append(meta)
        print(f"{sid}: {meta['duration_s']} s, {meta['n_words']} words, ASR WER {report['asr_wer']}", flush=True)
    return out
