# AI-assistance disclosure

The hackathon rules allow AI coding assistants if their use is disclosed. This page lists every AI tool used and what it was used for. **Edit this page before submitting** so it matches exactly what your team did.

| Tool | Used for | Where |
|---|---|---|
| AI coding assistant | Code generation, refactoring, test writing, documentation drafts, debugging of the detection pipeline, dashboard implementation | `src/shruti/**`, `tests/**`, `web/**`, `docs/**`, `Makefile`, `docker/**` |
| wav2vec2-base-960h (Meta, via Hugging Face) | Pretrained speech model used *inside* SHRUTI for forced alignment only (no fine-tuning) | `src/shruti/align/ctc.py` |

What was **not** done by AI tools at run time: no language model is used anywhere in SHRUTI's scoring, detection, explanations or rubric. All flags come from statistical tests on measured acoustics, and every explanation sentence is a fixed template filled with stored measurements.

Team responsibilities: each module has a named owner who can explain it to a judge (fill in):

| Area | Owner |
|---|---|
| Data, Flaw Studio, dataset release | |
| Alignment, features, statistics, evaluation | |
| Injection engine, Ghost Coach | |
| Dashboard, API, video, report | |
