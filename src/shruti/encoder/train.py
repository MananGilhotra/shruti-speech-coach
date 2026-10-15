"""Train the contrastive delivery encoder on the dev split only, and calibrate its null.

Loss = margin contrastive (Hadsell et al. 2006) on cosine distance between the reference
window and the delivery window + cross-entropy of the flaw-type head. Windows from 25% of
the clean dev files are held out to form the empirical null distribution of distances.
"""
from __future__ import annotations

import json

import numpy as np
import torch
import torch.nn.functional as F

from shruti.config import DATA_DIR, load_config
from shruti.encoder.model import TYPES, DeliveryEncoder, PairHead, window_tensor
from shruti.features.word import cmvn

MODEL_DIR = DATA_DIR / "models"


def _take_for(item: dict, cfg: dict):
    from shruti.io.audio import load_audio
    from shruti.process import load_scripts
    from shruti.store import processed_take
    x = load_audio(DATA_DIR / item["audio"])
    return processed_take(x, load_scripts()[item["script_id"]]["transcript"], cfg)[0]


def build_pairs(items: list[dict], cfg: dict):
    from shruti.store import get_baseline
    refs, Xr, Xp, y, null_mask = {}, [], [], [], []
    for n, it in enumerate(items):
        sid = it["script_id"]
        if sid not in refs:
            R = get_baseline(sid, cfg, only_original=True).takes[0]
            mfr = cmvn(R.frames.mfcc)
            refs[sid] = [window_tensor(R, w, mfr) for w in range(len(R.words))]
        P = _take_for(it, cfg)
        mf = cmvn(P.frames.mfcc)
        held_out = it["layer"] in ("clean", "voice", "identity") and (n % 4 == 0)
        for w in range(1, len(P.words) - 1):
            xr, xp = refs[sid][w], window_tensor(P, w, mf)
            if xr is None or xp is None:
                continue
            lab = "none"
            for l in it["labels"]:
                if l["words"][0] <= w + 1 and l["words"][1] >= w - 1:
                    lab = l["type"]
                    break
            Xr.append(xr)
            Xp.append(xp)
            y.append(TYPES.index(lab))
            null_mask.append(held_out and lab == "none")
    return np.stack(Xr), np.stack(Xp), np.array(y), np.array(null_mask)


def train(epochs: int = 6, margin: float = 0.5, seed: int = 1337, scripts: list[str] | None = None,
          name: str = "encoder") -> dict:
    from shruti.dataset.bench import load_labels
    cfg = load_config()
    torch.manual_seed(seed)
    np.random.seed(seed)
    items = [it for it in load_labels("dev") if scripts is None or it["script_id"] in scripts]
    Xr, Xp, y, null_mask = build_pairs(items, cfg)
    tr = ~null_mask
    enc, head = DeliveryEncoder(), PairHead()
    opt = torch.optim.Adam(list(enc.parameters()) + list(head.parameters()), lr=1e-3)
    idx_flaw = np.flatnonzero(tr & (y > 0))
    idx_clean = np.flatnonzero(tr & (y == 0))
    rng = np.random.default_rng(seed)
    log = []
    for ep in range(epochs):
        # balanced epoch: every flawed window + an equal number of clean ones
        sel = np.concatenate([idx_flaw, rng.choice(idx_clean, size=min(len(idx_clean), 2 * len(idx_flaw)), replace=False)])
        rng.shuffle(sel)
        tot = 0.0
        for b in range(0, len(sel), 128):
            ib = sel[b:b + 128]
            r = enc(torch.from_numpy(Xr[ib]))
            p = enc(torch.from_numpy(Xp[ib]))
            d = 1 - (r * p).sum(1)
            yb = torch.from_numpy(y[ib])
            clean = (yb == 0).float()
            l_con = (clean * d ** 2 + (1 - clean) * F.relu(margin - d) ** 2).mean()
            l_cls = F.cross_entropy(head(r, p), yb)
            loss = l_con + 0.5 * l_cls
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += float(loss) * len(ib)
        log.append(round(tot / len(sel), 4))
        print(f"epoch {ep + 1}: loss {log[-1]}", flush=True)
    enc.eval()
    head.eval()
    with torch.no_grad():
        nr = enc(torch.from_numpy(Xr[null_mask]))
        npp = enc(torch.from_numpy(Xp[null_mask]))
        null_d = np.sort((1 - (nr * npp).sum(1)).numpy())
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    torch.save({"encoder": enc.state_dict(), "head": head.state_dict()}, MODEL_DIR / f"{name}.pt")
    np.save(MODEL_DIR / f"{name}_null.npy", null_d)
    info = {"n_pairs": int(len(y)), "n_flawed": int((y > 0).sum()), "n_null": int(null_mask.sum()),
            "epochs": epochs, "margin": margin, "loss": log, "null_d_p95": float(np.percentile(null_d, 95)),
            "null_d_p99": float(np.percentile(null_d, 99)),
            "trained_on": f"dev scripts {scripts or ['S1', 'S2', 'S3', 'S4']}"}
    (MODEL_DIR / f"{name}.json").write_text(json.dumps(info, indent=1))
    return info
