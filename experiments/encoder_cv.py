import json, sys
from shruti.config import load_config
from shruti.dataset.bench import load_labels
from shruti.eval.run import predict_item
from shruti.eval.metrics import evaluate
items = [it for it in load_labels("dev") if it["script_id"] == sys.argv[1]]
model = sys.argv[2]
for name, ov in [("stats only", {}), ("stats + encoder", {"detect": {"encoder": {"enabled": True, "model": model}}}),
                 ("stats + encoder (type prob >= 0.6)", {"detect": {"encoder": {"enabled": True, "model": model, "min_type_prob": 0.6}}})]:
    cfg = load_config(overrides=ov)
    preds = [predict_item(it, cfg) for it in items]
    r = evaluate(items, preds, thr=0.5, B=100)
    ff = r["false_flags"]
    cm = sum(ff[k]["minutes"] for k in ("clean", "identity", "gradient-L0") if k in ff)
    cf = sum(ff[k]["flags"] for k in ("clean", "identity", "gradient-L0") if k in ff)
    print(f"{name:<36} F1 {r['micro']['f1']:.3f}  P {r['micro']['precision']:.3f}  R {r['micro']['recall']:.3f}  macroF1 {r['macro_f1']:.3f}  clean FF/min {cf/cm:.2f}  voice FF/min {ff['voice']['per_minute']:.2f}")
    print("    per type F1:", {k: round(v['f1'], 2) if v['f1'] == v['f1'] else None for k, v in r['per_type'].items()})
