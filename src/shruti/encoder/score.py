"""Encoder tests: distance between a delivery window and the reference window, turned into a
p-value with the empirical null of clean held-out dev windows, typed by the pair head.

Only phrase-level flaw types come from the encoder (pauses, fillers and stutters are measured
directly and better by the statistical detectors).
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
from scipy import stats

from shruti.encoder.model import TYPES, DeliveryEncoder, PairHead, window_tensor
from shruti.features.word import cmvn

PHRASE_TYPES = {"rushed", "dragged", "monotone", "volume_fade", "mumble", "misplaced_emphasis"}


@lru_cache(maxsize=4)
def load_model(name: str = "encoder"):
    import torch
    from shruti.encoder.train import MODEL_DIR
    p = MODEL_DIR / f"{name}.pt"
    if not p.exists():
        return None
    state = torch.load(p, map_location="cpu", weights_only=True)
    enc, head = DeliveryEncoder(), PairHead()
    enc.load_state_dict(state["encoder"])
    head.load_state_dict(state["head"])
    enc.eval()
    head.eval()
    null = np.load(MODEL_DIR / f"{name}_null.npy")
    return enc, head, null


def encoder_tests(P, B, cfg) -> list:
    import torch
    from shruti.detect.core import Test

    ec = cfg["detect"].get("encoder", {})
    m = load_model(ec.get("model", "encoder"))
    if m is None:
        return []
    enc, head, null = m
    min_prob = float(ec.get("min_type_prob", 0.4))
    W = len(P.words)
    mf = cmvn(P.frames.mfcc)
    idx, xp = [], []
    for w in range(1, W - 1):
        t = window_tensor(P, w, mf)
        if t is not None:
            idx.append(w)
            xp.append(t)
    if not idx:
        return []
    refs = []
    for R in B.takes:
        mfr = cmvn(R.frames.mfcc)
        refs.append(np.stack([window_tensor(R, w, mfr) for w in idx]))
    with torch.no_grad():
        ep = enc(torch.from_numpy(np.stack(xp)))
        best_d, best_logits = None, None
        for xr in refs:
            er = enc(torch.from_numpy(xr))
            d = 1 - (er * ep).sum(1)
            logits = head(er, ep)
            if best_d is None:
                best_d, best_logits = d, logits
            else:
                take = d < best_d
                best_d = torch.where(take, d, best_d)
                best_logits = torch.where(take[:, None], logits, best_logits)
        probs = torch.softmax(best_logits, dim=1).numpy()
        d = best_d.numpy()
    # log-normal fit to the clean-window distances resolves tail p-values beyond 1/len(null)
    ln = np.log(np.maximum(null, 1e-4))
    mu, sd = float(ln.mean()), float(ln.std() + 1e-6)
    out = []
    for k, w in enumerate(idx):
        p = float(stats.norm.sf((np.log(max(d[k], 1e-4)) - mu) / sd))
        ti = int(np.argmax(probs[k, 1:])) + 1
        ftype = TYPES[ti]
        if ftype not in PHRASE_TYPES:
            continue
        z = float(stats.norm.isf(p))
        out.append(Test("encoder", ftype, w - 1, w + 1, float(d[k]), z, float(p),
                        bool(probs[k, ti] >= min_prob and probs[k, 0] < 0.5),
                        {"distance": float(d[k]), "type_prob": float(probs[k, ti]), "none_prob": float(probs[k, 0]),
                         "null_p95": float(np.percentile(null, 95))}))
    return out
