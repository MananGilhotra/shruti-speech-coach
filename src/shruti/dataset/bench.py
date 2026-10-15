"""SHRUTI-Bench synthetic layers: recipes (small, versioned) and their renders (regenerable).

Layers per reference take
  identity   the take passed through the same PSOLA chain with no change (artefact control)
  clean      natural-variation nuisance only (tempo, word timing, pitch, loudness, voice) -> 0 flaws
  single     one flaw type at one of 10 severity levels
  gradient   a fixed bundle of 3 flaws swept from level 0 (clean) to 10 (egregious)
  voice      large timbre/pitch change, nothing else (a different "speaker") -> 0 flaws
  stress     recording conditions (noise, phone, reverb, MP3, gain) on clean and flawed takes
Split: scripts S1-S4 are dev (anything may be tuned on them), S5-S6 are test (unseen
speakers and texts; evaluated once, after the freeze).
"""
from __future__ import annotations

import hashlib
import json
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from shruti.config import DATA_DIR, load_config
from shruti.inject.engine import FLAW_TYPES, ladder_param, make_flaw, render, sample_nuisance
from shruti.io.audio import load_audio, save_audio, sha256_file
from shruti.process import load_scripts
from shruti.store import ORIGINALS_DIR, processed_take
from shruti.stress.conditions import CONDITIONS

BENCH_DIR = DATA_DIR / "bench"
RENDER_DIR = DATA_DIR / "renders"
TEST_SCRIPTS = {"S5", "S6"}


def split_of(script_id: str) -> str:
    return "test" if script_id in TEST_SCRIPTS else "dev"


def _seed(*parts) -> int:
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def source_take(script_id: str, cfg: dict):
    x = load_audio(ORIGINALS_DIR / f"{script_id}.flac")
    take, _ = processed_take(x, load_scripts()[script_id]["transcript"], cfg)
    return take, x


def make_recipes(cfg: dict | None = None, base_seed: int = 2026) -> list[dict]:
    cfg = cfg or load_config()
    nz_cfg = cfg["inject"]["nuisance"]
    ladder = cfg["inject"]["ladder"]
    out: list[dict] = []
    for sid in load_scripts():
        src, _ = source_take(sid, cfg)
        split = split_of(sid)

        def add(layer, name, seed, nuisance, flaws, condition=None, extra=None):
            out.append({"render_id": f"{sid}__{layer}__{name}", "script_id": sid, "source": "original",
                        "split": split, "layer": layer, "seed": seed, "nuisance": nuisance, "flaws": flaws,
                        "condition": condition, **(extra or {})})

        add("identity", "0", _seed(sid, "identity"), None, [])
        for n in range(6):
            rng = np.random.default_rng(_seed(base_seed, sid, "clean", n))
            add("clean", str(n), _seed(sid, "clean", n), sample_nuisance(rng, nz_cfg), [])
        for ft in FLAW_TYPES:
            for level in range(1, 11):
                rng = np.random.default_rng(_seed(base_seed, sid, ft, level))
                flaws = make_flaw(src, ft, level, rng, "f1", [], ladder)
                if not flaws:
                    continue
                add("single", f"{ft}-L{level:02d}", _seed(sid, ft, level), sample_nuisance(rng, nz_cfg), flaws,
                    extra={"flaw_type": ft, "level": level})
        for b in range(2):
            rng = np.random.default_rng(_seed(base_seed, sid, "gradient", b))
            types = [str(t) for t in rng.choice(FLAW_TYPES, size=3, replace=False)]
            taken: list = []
            sites = []
            for n, ft in enumerate(types):
                sites += make_flaw(src, ft, 10, rng, f"f{n + 1}", taken, ladder)
            nz = sample_nuisance(rng, nz_cfg)
            for level in range(0, 11):
                flaws = []
                for fl in sites:
                    if level == 0:
                        continue
                    if fl["type"] == "filler":
                        count = 1 + (level - 1) // 3
                        if fl["flaw_id"][-1:].isalpha() and ord(fl["flaw_id"][-1]) - 97 >= count:
                            continue
                    flaws.append({**fl, "level": level, "param": round(ladder_param(fl["type"], level, ladder), 4)})
                add("gradient", f"b{b}-L{level:02d}", _seed(sid, "gradient", b), nz, flaws,
                    extra={"bundle": types, "level": level})
        voices = [(0.86, -4.0), (0.93, -2.0), (1.08, 2.0), (1.16, 4.0)]
        for n, (fmt, shift) in enumerate(voices):
            add("voice", str(n), _seed(sid, "voice", n), {"formant_ratio": fmt, "pitch_shift_st": shift}, [],
                extra={"voice": {"formant_ratio": fmt, "pitch_shift_st": shift}})
        for cname, cond in CONDITIONS.items():
            rng = np.random.default_rng(_seed(base_seed, sid, "stress", cname))
            add("stress", f"{cname}-clean", _seed(sid, "stress", cname, 0), sample_nuisance(rng, nz_cfg), [],
                cond, {"condition_name": cname})
            for n in range(2):
                ft = str(rng.choice(FLAW_TYPES))
                flaws = make_flaw(src, ft, 7, rng, "f1", [], ladder)
                if flaws:
                    add("stress", f"{cname}-{ft}", _seed(sid, "stress", cname, n + 1),
                        sample_nuisance(rng, nz_cfg), flaws, cond, {"condition_name": cname, "flaw_type": ft})
    return out


# --------------------------------------------------------------------------- rendering
_worker_cache: dict = {}


def _init_worker():
    os.environ.setdefault("OMP_NUM_THREADS", "1")


def _render_one(recipe: dict) -> dict:
    cfg = load_config()
    sid = recipe["script_id"]
    if sid not in _worker_cache:
        _worker_cache[sid] = source_take(sid, cfg)
    src, x = _worker_cache[sid]
    r = render(recipe, src, x, cfg["inject"]["ladder"])
    path = RENDER_DIR / recipe["split"] / f"{recipe['render_id']}.flac"
    save_audio(path, r.audio)
    return {"render_id": recipe["render_id"], "script_id": sid, "split": recipe["split"], "layer": recipe["layer"],
            "audio": str(path.relative_to(DATA_DIR)), "duration_s": round(r.duration, 3),
            "sha256": sha256_file(path), "labels": r.labels,
            **{k: recipe[k] for k in ("flaw_type", "level", "bundle", "condition_name", "voice") if k in recipe}}


def build_bench(workers: int = 6, only: str | None = None) -> Path:
    cfg = load_config()
    BENCH_DIR.mkdir(parents=True, exist_ok=True)
    recipes = make_recipes(cfg)
    if only:
        recipes = [r for r in recipes if r["split"] == only]
    with open(BENCH_DIR / "recipes.jsonl", "w") as f:
        for r in recipes:
            f.write(json.dumps(r) + "\n")
    print(f"{len(recipes)} recipes", flush=True)
    rows = []
    with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker) as ex:
        for n, row in enumerate(ex.map(_render_one, recipes, chunksize=4), 1):
            rows.append(row)
            if n % 50 == 0:
                print(f"rendered {n}/{len(recipes)}", flush=True)
    rows.sort(key=lambda r: r["render_id"])
    path = BENCH_DIR / "labels.jsonl"
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    return path


def load_labels(split: str | None = None) -> list[dict]:
    path = BENCH_DIR / "labels.jsonl"
    rows = [json.loads(line) for line in open(path)]
    return [r for r in rows if split is None or r["split"] == split]
