# SHRUTI — Devpost submission text (copy-paste)

**Track:** C · Contrastive Speech Analytics & Temporal Flaw Grounding

**Tagline:** Hear exactly where your delivery broke — and hear yourself fix it.

## Inspiration
In debate and declamation, judges say "your delivery was weak" — but not *where* or *why*. Three judges can score the same speech three different ways. We wanted feedback that is exact, explainable and reproducible.

## What it does
SHRUTI compares your delivery of a famous speech with good deliveries of the *same text*, word by word. It pins every delivery flaw (rushed, dragged, long pause, missing pause, monotone, fading voice, mumbling, fillers, stutters, misplaced emphasis) to its exact start and end time, proves each flag with a statistical test under false-discovery-rate control, explains it with the numbers and the maths, and plays back **your own voice with that one flaw corrected** (Ghost Coach). It then re-analyses the corrected audio to confirm what caused the flag. A Drill mode lets you re-record one phrase and see the score change. Scores cover 7 dimensions (0–10) plus a WSDC-style Style mark.

## How we built it
- **Dataset (SHRUTI-Bench):** 6 public-domain presidential speeches (JFK, FDR, Obama, Eisenhower, Reagan) + a "bad mirror" of 10 flaw types × 10 severity levels, controls and stress conditions — 914 files, 10.5 h, 1,160 millisecond-labelled flaws, regenerable bit-for-bit from seeded recipes. Flaw Studio collects real human flawed takes where the on-screen instruction is the label.
- **Pipeline:** wav2vec2 CTC forced alignment (own Viterbi) → 10 ms features (Praat pitch, intensity, FFT spectral tilt/centroid, MFCC, cepstral peak prominence) → speaker normalisation → population baseline → ~450 tests per take → Benjamini–Hochberg FDR → regions with bootstrap 95% intervals → deterministic explanation cards → rubric → Ghost Coach (TD-PSOLA).
- **Stack:** Python, FastAPI, PyTorch/transformers, Parselmouth, librosa; React + TypeScript + Tailwind + wavesurfer.js + KaTeX.

## Results (held-out speakers and texts, evaluated once)
Precision 0.81 · event F1 0.50 (95% CI 0.43–0.55) · median boundary error ~20 ms · 0 false flags on flaw-free controls · score vs severity Spearman −0.95. Fillers (F1 0.88) and long pauses (0.78) are caught at mild severities; tempo, emphasis and mumbling only at high severity — reported honestly.

## Challenges
Aligners glue hesitations onto words and drop short words into pauses; noise hides silences. We added global silence assignment, noise-adaptive thresholds and onset repair, and kept FDR control so precision stays high.

## Accomplishments
A contrastive dataset that did not exist before, flags with real statistical guarantees, ~20 ms grounding, and a coach that lets you hear your better self.

## What's next
Calibrate priors from human recordings, run the adjudicator study, add Hindi and reference-free (extempore) modes.

## Built with
python, fastapi, pytorch, transformers (wav2vec2), praat-parselmouth, librosa, scipy, statsmodels, react, typescript, vite, tailwindcss, wavesurfer.js, katex, docker. AI coding assistant used and disclosed (see docs/AI_USAGE.md).

## Links
- GitHub: https://github.com/MananGilhotra/shruti
- Demo video: <YouTube link>
