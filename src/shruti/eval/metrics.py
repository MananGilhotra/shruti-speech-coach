"""Benchmark metrics: event P/R/F1, boundary error, false flags per minute, psychometric
thresholds, severity monotonicity, robustness, with bootstrap confidence intervals."""
from __future__ import annotations

from collections import defaultdict

import numpy as np
from scipy import optimize, stats

from shruti.eval.match import match
from shruti.inject.engine import FLAW_TYPES

CONTROL_LAYERS = {"identity", "clean", "voice"}


def _prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else float("nan")
    r = tp / (tp + fn) if tp + fn else float("nan")
    f = 2 * p * r / (p + r) if p == p and r == r and p + r > 0 else float("nan")
    return {"tp": tp, "fp": fp, "fn": fn, "precision": p, "recall": r, "f1": f}


def _file_counts(lab: dict, pred: dict, thr: float) -> tuple[list, list, list]:
    return match(lab["labels"], pred.get("preds", []), thr)


def _boot_ci(per_file: list[tuple[int, int, int]], B: int, seed: int) -> dict:
    """Percentile bootstrap over files for micro precision / recall / F1."""
    if not per_file:
        return {}
    arr = np.array(per_file, dtype=float)
    rng = np.random.default_rng(seed)
    fs, ps, rs = [], [], []
    for _ in range(B):
        s = arr[rng.integers(0, len(arr), len(arr))].sum(axis=0)
        tp, fp, fn = s
        p = tp / (tp + fp) if tp + fp else np.nan
        r = tp / (tp + fn) if tp + fn else np.nan
        ps.append(p)
        rs.append(r)
        fs.append(2 * p * r / (p + r) if p + r > 0 else np.nan)
    ci = lambda v: [float(np.nanpercentile(v, 2.5)), float(np.nanpercentile(v, 97.5))]  # noqa: E731
    return {"precision": ci(ps), "recall": ci(rs), "f1": ci(fs)}


def _logistic(L, l50, s):
    return 1.0 / (1.0 + np.exp(-(L - l50) / s))


def psychometric(levels: np.ndarray, hits: np.ndarray) -> dict:
    """Fit detection probability vs severity level; L50 = level detected half the time."""
    rates = {int(L): float(hits[levels == L].mean()) for L in np.unique(levels)}
    try:
        def nll(theta):
            p = np.clip(_logistic(levels, theta[0], abs(theta[1]) + 1e-3), 1e-6, 1 - 1e-6)
            return -np.sum(hits * np.log(p) + (1 - hits) * np.log(1 - p))
        res = optimize.minimize(nll, x0=[5.0, 1.0], method="Nelder-Mead")
        l50, s = float(res.x[0]), float(abs(res.x[1]) + 1e-3)
        if not np.isfinite(l50) or l50 > 15:
            l50 = float("inf")
    except Exception:  # pragma: no cover
        l50, s = float("nan"), float("nan")
    return {"rates": rates, "L50": l50, "slope": s}


def evaluate(labels: list[dict], preds: list[dict], thr: float = 0.5, B: int = 2000, seed: int = 1337,
             report_thrs=(0.3, 0.5, 0.7)) -> dict:
    by_id = {p["render_id"]: p for p in preds}
    labels = [l for l in labels if l["render_id"] in by_id]
    out: dict = {"n_files": len(labels), "iou_threshold": thr}

    # ------------------------------------------------ event detection on flawed files
    flawed = [l for l in labels if l["labels"]]
    per_type = defaultdict(lambda: [0, 0, 0])
    per_file = []
    bound_start, bound_end, ious = [], [], []
    confusion = defaultdict(lambda: defaultdict(int))
    for lab in flawed:
        m, fps, fns = _file_counts(lab, by_id[lab["render_id"]], thr)
        per_file.append((len(m), len(fps), len(fns)))
        for l_, p_, i in m:
            per_type[l_["type"]][0] += 1
            bound_start.append(abs(p_["t_start"] - l_["t_start"]) * 1000)
            bound_end.append(abs(p_["t_end"] - l_["t_end"]) * 1000)
            ious.append(i)
        for p_ in fps:
            per_type[p_["type"]][1] += 1
        for l_ in fns:
            per_type[l_["type"]][2] += 1
        # confusion: what each missed label was called instead (any overlapping prediction)
        for l_ in lab["labels"]:
            hit = [p_ for p_ in by_id[lab["render_id"]].get("preds", [])
                   if min(p_["t_end"], l_["t_end"]) > max(p_["t_start"], l_["t_start"])]
            confusion[l_["type"]][hit[0]["type"] if hit else "(none)"] += 1
    tot = np.array(per_file).sum(axis=0) if per_file else np.zeros(3, int)
    out["micro"] = _prf(int(tot[0]), int(tot[1]), int(tot[2]))
    out["micro_ci"] = _boot_ci(per_file, B, seed)
    out["per_type"] = {t: _prf(*per_type[t]) for t in FLAW_TYPES if sum(per_type[t])}
    f1s = [v["f1"] for v in out["per_type"].values() if v["f1"] == v["f1"]]
    out["macro_f1"] = float(np.mean(f1s)) if f1s else float("nan")
    out["boundary_ms"] = {"start_median": float(np.median(bound_start)) if bound_start else None,
                          "end_median": float(np.median(bound_end)) if bound_end else None,
                          "start_p90": float(np.percentile(bound_start, 90)) if bound_start else None,
                          "end_p90": float(np.percentile(bound_end, 90)) if bound_end else None,
                          "mean_iou": float(np.mean(ious)) if ious else None}
    out["confusion"] = {k: dict(v) for k, v in confusion.items()}
    out["by_iou"] = {}
    for t in report_thrs:
        tt = np.zeros(3, int)
        for lab in flawed:
            m, fps, fns = _file_counts(lab, by_id[lab["render_id"]], t)
            tt += (len(m), len(fps), len(fns))
        out["by_iou"][str(t)] = _prf(*map(int, tt))

    # ------------------------------------------------ psychometric curves (single-flaw layer)
    psy = {}
    for t in FLAW_TYPES:
        rows = [l for l in labels if l["layer"] == "single" and l.get("flaw_type") == t]
        if not rows:
            continue
        lv, hit = [], []
        for lab in rows:
            m, _, _ = _file_counts(lab, by_id[lab["render_id"]], 0.3)
            n_lab = len(lab["labels"])
            lv.append(lab["level"])
            hit.append(1.0 if n_lab and len([x for x in m if x[0]["type"] == t]) >= max(1, n_lab // 2 + n_lab % 2) else 0.0)
        psy[t] = psychometric(np.array(lv, float), np.array(hit, float))
    out["psychometric"] = psy

    # ------------------------------------------------ false flags on controls
    ff = {}
    for layer in sorted(CONTROL_LAYERS | {"stress-clean", "gradient-L0"}):
        if layer == "stress-clean":
            rows = [l for l in labels if l["layer"] == "stress" and not l["labels"]]
        elif layer == "gradient-L0":
            rows = [l for l in labels if l["layer"] == "gradient" and l.get("level") == 0]
        else:
            rows = [l for l in labels if l["layer"] == layer]
        if not rows:
            continue
        n = sum(len(by_id[l["render_id"]].get("preds", [])) for l in rows)
        mins = sum(l["duration_s"] for l in rows) / 60.0
        ff[layer] = {"files": len(rows), "flags": n, "minutes": round(mins, 2),
                     "per_minute": n / mins if mins else float("nan"),
                     "files_with_any_flag": sum(1 for l in rows if by_id[l["render_id"]].get("preds"))}
    out["false_flags"] = ff

    # ------------------------------------------------ severity monotonicity (gradient layer)
    grad = defaultdict(list)
    for l in labels:
        if l["layer"] == "gradient":
            grad[l["render_id"].rsplit("-L", 1)[0]].append((l["level"], by_id[l["render_id"]].get("overall", np.nan)))
    rhos = []
    for _, pts in grad.items():
        pts.sort()
        lv, sc = zip(*pts)
        if np.std(sc) > 0:
            rhos.append(stats.spearmanr(lv, sc).statistic)
    out["gradient"] = {"series": len(grad), "spearman_median": float(np.median(rhos)) if rhos else None,
                       "spearman_all": [round(float(r), 3) for r in rhos]}

    # ------------------------------------------------ robustness per condition
    rob = {}
    for l in labels:
        if l["layer"] != "stress" or not l["labels"]:
            continue
        c = l.get("condition_name")
        m, fps, fns = _file_counts(l, by_id[l["render_id"]], thr)
        r = rob.setdefault(c, [0, 0, 0])
        r[0] += len(m)
        r[1] += len(fps)
        r[2] += len(fns)
    out["robustness"] = {c: _prf(*v) for c, v in sorted(rob.items())}
    out["errors"] = [p["render_id"] for p in preds if p.get("error")]
    return out
