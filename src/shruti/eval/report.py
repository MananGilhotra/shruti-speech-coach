"""Benchmark report: metrics JSON, markdown tables and figures for the README / technical report."""
from __future__ import annotations

import hashlib
import json
import subprocess

import numpy as np

from shruti.config import RESULTS_DIR, ROOT, load_config
from shruti.inject.engine import FLAW_TYPES

OUT = RESULTS_DIR / "benchmark"
FIG = OUT / "figures"
NICE = {"rushed": "Rushed", "dragged": "Dragged", "long_pause": "Long pause", "missing_pause": "Missing pause",
        "monotone": "Monotone", "volume_fade": "Volume fade", "mumble": "Mumble", "filler": "Filler",
        "stutter": "Stutter", "misplaced_emphasis": "Misplaced emphasis"}
DIM_COLOR = {"rushed": "#0072B2", "dragged": "#005a8c", "long_pause": "#E69F00", "missing_pause": "#b37a00",
             "monotone": "#009E73", "volume_fade": "#CC79A7", "mumble": "#56B4E9", "filler": "#D55E00",
             "stutter": "#8f3f00", "misplaced_emphasis": "#9a8a00"}


def json_safe(o):
    """Replace NaN / inf by None so the JSON is standard (FastAPI refuses NaN)."""
    if isinstance(o, float):
        return o if np.isfinite(o) else None
    if isinstance(o, (np.floating,)):
        return float(o) if np.isfinite(o) else None
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, dict):
        return {str(k): json_safe(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [json_safe(v) for v in o]
    return o


def _load(path):
    return [json.loads(line) for line in open(path)]


def _r(v, n=3):
    return None if v is None or (isinstance(v, float) and not np.isfinite(v)) else round(float(v), n)


def evaluate_split(tag: str, split: str) -> dict:
    from shruti.dataset.bench import load_labels
    from shruti.eval.metrics import evaluate

    cfg = load_config()
    preds = _load(OUT.parent / "bench" / f"predictions_{tag}_{split}.jsonl")
    res = evaluate(load_labels(split), preds, thr=cfg["eval"]["iou_match"], B=cfg["eval"]["bootstrap_B"],
                   seed=cfg["eval"]["seed"])
    res["predictions_sha256"] = hashlib.sha256(
        (OUT.parent / "bench" / f"predictions_{tag}_{split}.jsonl").read_bytes()).hexdigest()
    return res


def _fmt(v, pct=False):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return "–"
    return f"{100 * v:.1f}%" if pct else f"{v:.2f}"


def tables_md(res: dict, split: str) -> str:
    m, ci = res["micro"], res.get("micro_ci", {})
    lines = [f"### {split} split ({res['n_files']} files)", "",
             f"Event F1 {_fmt(m['f1'])} (95% CI {_fmt(ci.get('f1', [None])[0])}–{_fmt(ci.get('f1', [None, None])[1])}), "
             f"precision {_fmt(m['precision'])}, recall {_fmt(m['recall'])} at temporal IoU ≥ {res['iou_threshold']}; "
             f"macro F1 {_fmt(res['macro_f1'])}. Boundary error median {_fmt(res['boundary_ms']['start_median'])} ms (start), "
             f"{_fmt(res['boundary_ms']['end_median'])} ms (end); mean IoU of matches {_fmt(res['boundary_ms']['mean_iou'])}.", "",
             "| Flaw | Precision | Recall | F1 | TP | FP | FN | L50 (level detected half the time) |",
             "|---|---|---|---|---|---|---|---|"]
    for t in FLAW_TYPES:
        if t not in res["per_type"]:
            continue
        v = res["per_type"][t]
        l50 = res["psychometric"].get(t, {}).get("L50")
        l50s = "–" if l50 is None else ("> 10" if not np.isfinite(l50) or l50 > 10 else f"{l50:.1f}")
        lines.append(f"| {NICE[t]} | {_fmt(v['precision'])} | {_fmt(v['recall'])} | {_fmt(v['f1'])} | {v['tp']} | {v['fp']} | {v['fn']} | {l50s} |")
    lines += ["", "| Control layer (no flaw present) | Files | Flags | Minutes | False flags / min | Files with any flag |",
              "|---|---|---|---|---|---|"]
    for k, v in res["false_flags"].items():
        lines.append(f"| {k} | {v['files']} | {v['flags']} | {v['minutes']} | {_fmt(v['per_minute'])} | {v['files_with_any_flag']} |")
    if res.get("robustness"):
        lines += ["", "| Recording condition (flawed files) | Precision | Recall | F1 |", "|---|---|---|---|"]
        for k, v in res["robustness"].items():
            lines.append(f"| {k} | {_fmt(v['precision'])} | {_fmt(v['recall'])} | {_fmt(v['f1'])} |")
    g = res.get("gradient", {})
    if g.get("spearman_median") is not None:
        lines += ["", f"Severity monotonicity: median Spearman ρ between overall score and severity level over "
                      f"{g['series']} gradient series = {_fmt(g['spearman_median'])}."]
    return "\n".join(lines) + "\n"


def figures(res_by_split: dict) -> list[str]:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    FIG.mkdir(parents=True, exist_ok=True)
    names = []
    for split, res in res_by_split.items():
        fig, ax = plt.subplots(figsize=(7.5, 4.2), dpi=150)
        for t in FLAW_TYPES:
            ps = res["psychometric"].get(t)
            if not ps:
                continue
            lv = sorted(int(k) for k in ps["rates"])
            ax.plot(lv, [ps["rates"][k] if k in ps["rates"] else ps["rates"][str(k)] for k in lv], "-o", ms=3,
                    lw=1.4, color=DIM_COLOR[t], label=NICE[t])
        ax.set_xlabel("Severity level (1 = almost perfect, 10 = egregious)")
        ax.set_ylabel("Detection rate (IoU ≥ 0.3)")
        ax.set_ylim(-0.03, 1.03)
        ax.set_xticks(range(1, 11))
        ax.grid(alpha=0.25)
        ax.legend(fontsize=7, ncol=2, frameon=False, loc="lower right")
        ax.set_title(f"Detection rate rises with severity ({split} split)", fontsize=10, loc="left")
        fig.tight_layout()
        n = f"psychometric_{split}.png"
        fig.savefig(FIG / n)
        plt.close(fig)
        names.append(n)

        fig, ax = plt.subplots(figsize=(7.5, 3.6), dpi=150)
        ts = [t for t in FLAW_TYPES if t in res["per_type"]]
        f1 = [res["per_type"][t]["f1"] if res["per_type"][t]["f1"] == res["per_type"][t]["f1"] else 0 for t in ts]
        ax.barh([NICE[t] for t in ts][::-1], f1[::-1], color=[DIM_COLOR[t] for t in ts][::-1])
        for y, v in enumerate(f1[::-1]):
            ax.text(v + 0.01, y, f"{v:.2f}", va="center", fontsize=7)
        ax.set_xlim(0, 1.08)
        ax.set_xlabel("Event F1 at temporal IoU ≥ 0.5 (all severity levels pooled)")
        ax.set_title(f"F1 by flaw type ({split} split)", fontsize=10, loc="left")
        fig.tight_layout()
        n = f"f1_by_type_{split}.png"
        fig.savefig(FIG / n)
        plt.close(fig)
        names.append(n)
    return names


def make_report(tag: str = "frozen", splits=("dev", "test")) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    res_by_split = {}
    for split in splits:
        p = OUT.parent / "bench" / f"predictions_{tag}_{split}.jsonl"
        if not p.exists():
            print(f"skip {split}: {p} missing")
            continue
        res_by_split[split] = evaluate_split(tag, split)
    if not res_by_split:
        return {}
    figs = figures(res_by_split)
    md = "\n".join(tables_md(r, s) for s, r in res_by_split.items())
    (OUT / f"tables_{tag}.md").write_text(md)
    from shruti.config import config_hash
    cfg = load_config()
    summary = json_safe({**res_by_split, "tag": tag, "figures": figs, "config_hash": config_hash(cfg),
                         "config": cfg, "generated_by": "python -m shruti eval"})
    (OUT / f"metrics_{tag}.json").write_text(json.dumps(summary, indent=1))
    if tag == "frozen":
        (OUT / "summary.json").write_text(json.dumps(summary, indent=1))
    print(md)
    return summary


def assert_frozen() -> None:
    out = subprocess.run(["git", "-C", str(ROOT), "tag", "--points-at", "HEAD"], capture_output=True, text=True).stdout
    if "v1.0-frozen" not in out.split():
        raise SystemExit("The test split is evaluated only on the commit tagged v1.0-frozen.")


def compare_with_committed() -> bool:
    p = OUT / "summary.json"
    if not p.exists():
        print("no committed summary.json to compare with")
        return False
    old = json.loads(p.read_text())
    ok = True
    for split in ("dev", "test"):
        if split not in old:
            continue
        new = evaluate_split("frozen", split)
        same = new["predictions_sha256"] == old[split]["predictions_sha256"]
        print(f"{split}: predictions {'identical' if same else 'DIFFERENT'} "
              f"(F1 {old[split]['micro']['f1']:.4f} -> {new['micro']['f1']:.4f})")
        ok = ok and same
    return ok
