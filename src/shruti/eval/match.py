"""One-to-one matching of predicted and labelled flaw regions by temporal IoU."""
from __future__ import annotations

import numpy as np
from scipy.optimize import linear_sum_assignment


def iou(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = max(a[1], b[1]) - min(a[0], b[0])
    return inter / union if union > 0 else 0.0


def match(labels: list[dict], preds: list[dict], thr: float) -> tuple[list[tuple[dict, dict, float]], list[dict], list[dict]]:
    """Hungarian matching within each flaw type. Returns (matches, false positives, false negatives)."""
    matches, fps, fns = [], [], []
    types = {x["type"] for x in labels} | {x["type"] for x in preds}
    for t in sorted(types):
        L = [x for x in labels if x["type"] == t]
        P = [x for x in preds if x["type"] == t]
        if not L:
            fps += P
            continue
        if not P:
            fns += L
            continue
        M = np.array([[iou((l["t_start"], l["t_end"]), (p["t_start"], p["t_end"])) for p in P] for l in L])
        r, c = linear_sum_assignment(-M)
        used_l, used_p = set(), set()
        for i, j in zip(r, c):
            if M[i, j] >= thr:
                matches.append((L[i], P[j], float(M[i, j])))
                used_l.add(i)
                used_p.add(j)
        fns += [L[i] for i in range(len(L)) if i not in used_l]
        fps += [P[j] for j in range(len(P)) if j not in used_p]
    return matches, fps, fns
