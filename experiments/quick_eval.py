"""Detection-only re-run on cached dev takes with config overrides, then metrics (for tuning on dev)."""
import json, sys, copy, time
from shruti.config import load_config
from shruti.dataset.bench import load_labels
from shruti.eval.run import predict_item
from shruti.eval.metrics import evaluate
from shruti.eval.report import tables_md

def run(overrides: dict, legacy_cache=True, split="dev", B=200, quiet=False):
    cfg = load_config(overrides=overrides)
    if legacy_cache:
        cfg["features"].pop("version", None)
    items = load_labels(split)
    t = time.time()
    preds = [predict_item(it, cfg) for it in items]
    res = evaluate(items, preds, thr=0.5, B=B)
    if not quiet:
        print(tables_md(res, f"{split} {json.dumps(overrides)[:120]} ({time.time()-t:.0f}s)"))
    return res, preds

if __name__ == "__main__":
    ov = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    run(ov)
