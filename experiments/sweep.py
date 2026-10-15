import json, sys
sys.path.insert(0, "experiments")
from quick_eval import run
grid = [
  {"detect": {"fdr_q": 0.05}},
  {"detect": {"fdr_q": 0.10}},
  {"detect": {"fdr_q": 0.20}},
  {"detect": {"fdr_q": 0.10, "empirical_null": {"enabled": False}}},
  {"detect": {"fdr_q": 0.10}, "baseline": {"priors": {"log_dur": 0.12}}},
]
rows = []
for ov in grid:
    res, _ = run(ov, legacy_cache=False, quiet=True, B=100)
    ff = res["false_flags"]
    clean_ff = (ff["clean"]["flags"] + ff["gradient-L0"]["flags"] + ff["identity"]["flags"]) / (ff["clean"]["minutes"] + ff["gradient-L0"]["minutes"] + ff["identity"]["minutes"])
    row = {"ov": json.dumps(ov), "f1": round(res["micro"]["f1"], 3), "P": round(res["micro"]["precision"], 3), "R": round(res["micro"]["recall"], 3),
           "macroF1": round(res["macro_f1"], 3), "clean_ff_min": round(clean_ff, 2), "voice_ff": round(ff["voice"]["per_minute"], 2), "stress_ff": round(ff["stress-clean"]["per_minute"], 2),
           "per_type_f1": {k: round(v["f1"], 2) if v["f1"] == v["f1"] else None for k, v in res["per_type"].items()}}
    rows.append(row); print(json.dumps(row), flush=True)
json.dump(rows, open("results/cache/sweep_v2.json", "w"), indent=1)
