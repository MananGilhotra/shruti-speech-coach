"""Run the detector over SHRUTI-Bench renders and store predictions.

Takes are processed once and cached (alignment + features), so re-running detection with
different detection settings is fast; that is what dev-set tuning uses.
"""
from __future__ import annotations

import json
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from shruti.config import DATA_DIR, RESULTS_DIR, load_config

PRED_DIR = RESULTS_DIR / "bench"
_state: dict = {}


def _init(threads: int = 2):
    os.environ["OMP_NUM_THREADS"] = str(threads)
    try:
        import torch
        torch.set_num_threads(threads)
    except Exception:  # pragma: no cover
        pass


def predict_item(item: dict, cfg: dict | None = None, use_cache: bool = True) -> dict:
    from shruti.detect.core import detect
    from shruti.io.audio import load_audio
    from shruti.process import load_scripts
    from shruti.rubric.score import score, style_notes
    from shruti.store import get_baseline, processed_take

    cfg = cfg or _state.setdefault("cfg", load_config())
    sid = item["script_id"]
    x = load_audio(DATA_DIR / item["audio"])
    P, report = processed_take(x, load_scripts()[sid]["transcript"], cfg, use_cache=use_cache)
    B = get_baseline(sid, cfg, only_original=True)
    regions, tests, g = detect(P, B, cfg)
    style = style_notes(g, P.summary, [t.summary for t in B.takes])
    speaking = P.summary["speech_end"] - P.summary["speech_start"]
    rub = score(regions, speaking, style, cfg)
    return {"render_id": item["render_id"], "n_tests": len(tests), "duration_s": item["duration_s"],
            "asr_wer": report.get("asr_wer"), "overall": rub["overall"],
            "dims": {d: v["score"] for d, v in rub["dimensions"].items()},
            "preds": [{"type": r.ftype, "t_start": r.t_start, "t_end": r.t_end, "z": round(r.z, 3),
                       "q": float(r.q), "severity": r.severity, "words": [r.i, r.j]} for r in regions]}


def _work(item: dict) -> dict:
    try:
        return predict_item(item)
    except Exception as e:  # keep going; failures are reported
        return {"render_id": item["render_id"], "error": f"{type(e).__name__}: {e}", "preds": []}


def run_predictions(split: str | None = None, workers: int = 4, tag: str = "default") -> Path:
    from shruti.dataset.bench import load_labels

    items = load_labels(split)
    PRED_DIR.mkdir(parents=True, exist_ok=True)
    out = PRED_DIR / f"predictions_{tag}_{split or 'all'}.jsonl"
    rows = []
    with ProcessPoolExecutor(max_workers=workers, initializer=_init) as ex:
        for n, row in enumerate(ex.map(_work, items, chunksize=2), 1):
            rows.append(row)
            if n % 50 == 0:
                print(f"predicted {n}/{len(items)}", flush=True)
    rows.sort(key=lambda r: r["render_id"])
    with open(out, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    return out


def redetect(split: str | None, cfg: dict) -> list[dict]:
    """Detection only, in-process, from cached takes (for tuning on dev)."""
    from shruti.dataset.bench import load_labels
    return [predict_item(it, cfg) for it in load_labels(split)]
