# Architecture

```
audio + transcript ──► 1 INGEST ──► 2 MEASURE ──► 3 JUDGE ──► 4 EXPLAIN & COACH ──► API / dashboard
```

| Stage | Module | What happens |
|---|---|---|
| Ingest | `io/audio.py`, `process.py` | Decode anything (libsndfile, ffmpeg fallback) to 16 kHz mono; quality gate (length, silence, clipping, greedy-CTC word error rate vs the script). |
| Align | `align/ctc.py` | wav2vec2-base-960h CTC emissions (30 s chunks with 1 s context) and our own exact CTC Viterbi with blank states → word spans and per-character times. |
| Frame features | `features/frame.py` | 10 ms grid: two-pass Praat F0 (speaker-adaptive floor/ceiling), intensity, harmonicity, 25 ms energy, STFT (spectral tilt = 1–5 kHz vs 0–1 kHz, centroid), MFCC 1–13, and our own cepstral peak prominence. Silence threshold adapts to the noise floor. |
| Word table | `features/word.py` | Silences found globally and assigned to the nearest word boundary (pause = silence length); word edges snapped ≤ 80 ms onto silence edges; hesitation material the aligner glued to the next word is split off (fillers: long, steady, flat-pitched; stutters: bursts matching the word onset frame-by-frame), gated by the aligner's character timing. Per word: duration, pause after, F0 median/peak/range/slope (semitones re speaker), intensity median/peak (dB re speaker), CPP, HNR, tilt, centroid, voicing, prominence. |
| Baseline | `baseline/population.py` | Per word and feature: median over reference takes after removing each reference speaker's global offset; spread shrunk toward a prior (empirical Bayes, ν₀ = 30) plus an alignment-noise term for short words; articulation time of every word window; pitch range of every window. |
| Tests | `detect/core.py`, `detect/fluency.py` | ~450 hypotheses per take: tempo (3-word windows inside phrases + whole inter-pause phrases, articulation time vs baseline), pauses (every gap), loudness drop (3-word windows), brightness loss (tilt + centroid), pitch-range collapse (5-word windows), emphasis shift (pitch + loudness peak on weak or key words), fillers and stutters. Each test has a z-score and a t reference distribution (df = ν₀ + n − 1); an empirical null per family may widen (never narrow) the null. |
| FDR | `detect/core.py` | Benjamini–Hochberg at q = 0.05 over all tests of the take, plus a practical floor in physical units (e.g. ≥ 20% tempo change, ≥ 0.35 s extra pause, ≥ 3.5 dB drop). |
| Regions | `detect/core.py`, `detect/bootstrap.py` | Surviving tests of one type merge into regions with exact start/end; bootstrap (40 replicates of alignment jitter, and reference resampling when ≥ 3 references) gives each edge a 95% interval and each region a confidence. |
| Explain | `explain/cards.py` | Deterministic templates: headline, explanation with the numbers, fix, evidence table, and the math panel (the actual test with numbers filled in). No language model anywhere in scoring or explanation. |
| Rubric | `rubric/score.py` | Seven dimensions, `S_d = max(0, 10 − (60/T)·Σ c(sev) − g_d)`, overall mean, WSDC-style Style mark. Every lost point traces to a card. |
| Coach | `coach/ghost.py` | Ghost Coach: TD-PSOLA re-delivery of only the flagged region in the user's own voice (duration, pauses with room tone, reference pitch contour blended β = 0.8, loudness, filler/stutter cuts, brightness). Counterfactual: re-analyse the corrected audio; if the flag clears, the fixed feature is the cause. Duet: the reference time-warped onto the user's word timing. |
| Data | `inject/engine.py`, `stress/conditions.py`, `dataset/*` | SHRUTI-Bench generation: seeded recipes → renders with exact labels via composed time maps; stress conditions; Flaw Studio assignment and review; demo and study packs. |
| Evaluation | `eval/*` | Hungarian matching at temporal IoU, metrics with bootstrap CIs, psychometric fits, false flags per minute, robustness, panel-study statistics (ICC, leave-one-judge-out). |
| Serving | `api/main.py`, `web/` | FastAPI (analysis, audio tracks, ghost, drill, studio, study, explorer, eval) + React dashboard served from `web/dist`. |

## Determinism
CPU inference, seeded bootstrap, no clocks in results, sorted iteration, cached takes keyed by audio hash + transcript + the config sections that affect features. Each analysis carries a fingerprint = SHA-256 of (audio hash, config hash, model id, code version, reference ids). `tests/integration/test_pipeline.py::test_golden_analysis_is_reproducible` asserts byte-identical JSON across runs.
