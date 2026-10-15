"""Configuration loading and project paths."""
from __future__ import annotations

import copy
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "configs"
DATA_DIR = ROOT / "data"
RESULTS_DIR = ROOT / "results"
SCRIPTS_DIR = DATA_DIR / "scripts"


def _deep_update(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_update(out[k], v)
        else:
            out[k] = v
    return out


@lru_cache(maxsize=8)
def _load_yaml(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_config(path: str | Path | None = None, overrides: dict | None = None) -> dict[str, Any]:
    """Load configs/default.yaml, optionally merged with another YAML and a dict of overrides."""
    cfg = copy.deepcopy(_load_yaml(str(CONFIG_DIR / "default.yaml")))
    if path is not None and Path(path).resolve() != (CONFIG_DIR / "default.yaml").resolve():
        cfg = _deep_update(cfg, _load_yaml(str(path)))
    if overrides:
        cfg = _deep_update(cfg, overrides)
    return cfg


def config_hash(cfg: dict) -> str:
    blob = json.dumps(cfg, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:16]
