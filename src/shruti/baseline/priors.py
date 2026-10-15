"""Estimate the prior spreads s0 from human good takes (Flaw Studio), instead of assuming them.

For every script with at least three accepted good takes, each feature's per-word deviations
are taken after removing every speaker's global offset (exactly as the baseline does); the
robust spread (1.4826 x MAD) per word is pooled over words and scripts. The result is written
to configs/priors_estimated.yaml for review; copy the values into default.yaml to adopt them.
"""
from __future__ import annotations

import numpy as np
import yaml

from shruti.baseline.population import FEATURES, OFFSET_FEATURES
from shruti.config import CONFIG_DIR, load_config
from shruti.io.audio import load_audio
from shruti.process import load_scripts
from shruti.store import STUDIO_ACCEPTED, processed_take


def estimate_priors(min_takes: int = 3) -> dict:
    cfg = load_config()
    scripts = load_scripts()
    pooled: dict[str, list[float]] = {f: [] for f in FEATURES}
    used = {}
    for sid, s in scripts.items():
        d = STUDIO_ACCEPTED / sid
        files = sorted(d.glob("*.wav")) + sorted(d.glob("*.flac")) if d.exists() else []
        if len(files) < min_takes:
            continue
        takes = [processed_take(load_audio(p), s["transcript"], cfg)[0] for p in files]
        used[sid] = len(takes)
        for feat in FEATURES:
            X = np.vstack([t.words[feat].to_numpy(float) for t in takes])
            if feat in OFFSET_FEATURES:
                m0 = np.nanmedian(X, axis=0)
                X = X - np.nanmedian(X - m0[None, :], axis=1)[:, None]
            m = np.nanmedian(X, axis=0)
            mad = 1.4826 * np.nanmedian(np.abs(X - m[None, :]), axis=0)
            pooled[feat] += [v for v in mad if np.isfinite(v)]
    if not used:
        raise SystemExit(f"need >= {min_takes} accepted good takes for at least one script in {STUDIO_ACCEPTED}")
    est = {f: round(float(np.median(v)), 4) for f, v in pooled.items() if v}
    out = {"estimated_from": used, "priors": est, "current_defaults": cfg["baseline"]["priors"]}
    (CONFIG_DIR / "priors_estimated.yaml").write_text(yaml.safe_dump(out, sort_keys=False))
    return out
