"""Contrastive delivery encoder.

A 3-word window of a delivery becomes a fixed-length sequence of interpretable frame
features (pitch, voicing, loudness, energy, CPP, tilt, centroid, MFCC, silence) plus its
duration. A small conv + BiGRU network maps it to a unit-norm 64-d embedding. Training is
Siamese and contrastive: the same words delivered cleanly (any voice, tempo, condition) are
pulled toward the reference delivery; the same words delivered with a flaw are pushed at
least a margin away. A typing head on the pair predicts which flaw it is.
"""
from __future__ import annotations

import numpy as np
import torch
from torch import nn
import torch.nn.functional as F

from shruti.features.word import Take, cmvn

T_FIX = 64
N_CH = 22
TYPES = ["none", "rushed", "dragged", "long_pause", "missing_pause", "monotone", "volume_fade", "mumble",
         "filler", "stutter", "misplaced_emphasis"]


def window_tensor(take: Take, w: int, mf: np.ndarray | None = None) -> np.ndarray | None:
    """Features of words w-1..w+1, resampled to T_FIX frames: [N_CH, T_FIX]."""
    W = len(take.words)
    if w < 1 or w > W - 2:
        return None
    fr = take.frames
    a = float(take.words["start"].iloc[w - 1])
    b = float(take.words["end"].iloc[w + 1])
    sl = fr.span(a, b)
    n = sl.stop - sl.start
    if n < 6:
        return None
    mf = cmvn(fr.mfcc) if mf is None else mf
    st = np.nan_to_num(fr.f0_st[sl], nan=0.0) / 6.0
    voiced = fr.voiced[sl].astype(float)
    ref_e = np.median(fr.energy_db[fr.voiced]) if fr.voiced.sum() > 10 else np.median(fr.energy_db)
    feats = [st, voiced, fr.int_rel[sl] / 10.0, (fr.energy_db[sl] - ref_e) / 10.0,
             (fr.cpp_db[sl] - 20.0) / 5.0, fr.tilt_db[sl] / 10.0,
             np.log2(fr.centroid_hz[sl] / 1000.0 + 1e-3), fr.silent[sl].astype(float)]
    X = np.vstack(feats + [mf[1:13, sl]])            # 8 + 12 = 20 channels
    src = np.linspace(0, 1, n)
    dst = np.linspace(0, 1, T_FIX)
    Xr = np.vstack([np.interp(dst, src, row) for row in X])
    dur = np.full((1, T_FIX), np.log(max(b - a, 0.05)))
    pause = np.full((1, T_FIX), float(np.nansum(take.words["nonspeech_after"].iloc[w - 1:w + 1])))
    out = np.vstack([Xr, dur, pause]).astype(np.float32)
    return np.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0)


class DeliveryEncoder(nn.Module):
    def __init__(self, ch: int = N_CH, hid: int = 64, emb: int = 64):
        super().__init__()
        self.conv = nn.Sequential(nn.Conv1d(ch, hid, 5, padding=2), nn.GELU(),
                                  nn.Conv1d(hid, hid, 5, padding=2), nn.GELU())
        self.gru = nn.GRU(hid, hid, batch_first=True, bidirectional=True)
        self.proj = nn.Linear(4 * hid, emb)

    def forward(self, x: torch.Tensor) -> torch.Tensor:          # x [B, C, T]
        h = self.conv(x).transpose(1, 2)                          # [B, T, H]
        h, _ = self.gru(h)                                        # [B, T, 2H]
        pooled = torch.cat([h.mean(1), h.max(1).values], dim=1)
        return F.normalize(self.proj(pooled), dim=1)


class PairHead(nn.Module):
    """Predicts the flaw type from a (reference, delivery) embedding pair."""
    def __init__(self, emb: int = 64):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(3 * emb, 64), nn.GELU(), nn.Linear(64, len(TYPES)))

    def forward(self, r: torch.Tensor, p: torch.Tensor) -> torch.Tensor:
        return self.net(torch.cat([p - r, p * r, p], dim=1))
