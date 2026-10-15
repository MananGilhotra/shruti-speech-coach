# Model card — SHRUTI delivery-flaw detector v1.0

## Overview
SHRUTI is not a single trained network. It is a measurement pipeline (forced alignment + acoustic features) followed by **statistical tests against a population baseline** with false-discovery-rate control. The only pretrained neural component is **wav2vec2-base-960h** (Meta), used unchanged for CTC forced alignment. An optional **contrastive delivery encoder** (trained by us on the dev split) is shipped *disabled* because it did not beat the statistics on a held-out script (see "Ablation").

## Intended use
- Coaching feedback on scripted speech delivery (debate, declamation, interpretive reading, public speaking practice): *where* a delivery departs from good deliveries of the same text, *how much*, and *what to try instead*.
- Research and teaching on temporal grounding of delivery flaws.

**Not intended for:** high-stakes judgement of people (grading, hiring, admissions), speaker identification, clinical speech assessment, or judging content/argument quality.

## Inputs and outputs
- Input: a recording (any common format, ≤ 3 min) and either a SHRUTI-Bench script id or a transcript plus a reference recording of the same text.
- Output: time-stamped flaw regions (10 types) with z, p, BH q, severity 1–5, bootstrap 95% intervals and confidence; explanation cards; a 7-dimension rubric (0–10) and a WSDC-style Style mark; Ghost Coach corrected audio and counterfactual checks; a reproducibility fingerprint.

## How decisions are made
1. Word and phone timing from forced alignment; frame features every 10 ms; per-word summaries normalised to the speaker (semitones re speaker median F0, dB re speaker median intensity, tempo relative to the speaker's own articulation rate).
2. ~450 tests per minute-long take (tempo windows and phrases, every pause, loudness windows, brightness windows, pitch-range windows, emphasis on weak/key words, fillers, stutters), each with a z-score against the baseline (spread shrunk toward a prior, ν₀ = 30).
3. Benjamini–Hochberg at q = 0.05 across all tests of the take, plus a practical-size floor in physical units.
4. Regions, bootstrap intervals, deterministic explanation templates, rubric.

## Evaluation data
SHRUTI-Bench synthetic layers (see `docs/DATASHEET.md`): 606 dev renders (scripts S1–S4: JFK ×2, FDR, Obama) used for all tuning; 308 test renders (S5–S6: Eisenhower, Reagan — unseen speakers *and* texts) evaluated once with the frozen configuration. Metrics: event precision/recall/F1 at temporal IoU ≥ 0.5 (Hungarian matching within type), boundary error, false flags per minute on flaw-free controls, detection rate vs severity (psychometric L50), score–severity Spearman ρ, robustness per recording condition. Results: `results/benchmark/` and the README.

## Ablation: contrastive encoder
A conv + BiGRU encoder over interpretable frame features, trained with a margin contrastive loss (clean deliveries of the same words pulled to the reference, flawed ones pushed away) plus a flaw-type head. Leave-one-script-out on dev (train S1–S3, test S4): statistics alone F1 0.363, statistics + encoder 0.359. The type head is informative (it recognises strong "dragged" windows with 0.86–0.98 probability) but its distance does not separate flawed from clean windows of an unseen speaker strongly enough to pass FDR control. It is therefore disabled by default (`detect.encoder.enabled: false`) and reported, not hidden.

## Ethical considerations
- **Speaker fairness.** Normalisation removes voice range, loudness and overall tempo; the voice-change control layer measures false flags under large timbre/pitch changes. The human layer will report false-flag rates by gender and accent group.
- **"Good" is defined by reference deliveries.** A deliberate stylistic choice can be flagged as a deviation; SHRUTI reports deviations, not artistic judgement.
- **No voice cloning.** Ghost Coach modifies only the uploader's own recording with signal processing (PSOLA); it never synthesises anyone else's voice.
- **Public figures.** Manipulated renders of public-domain speeches are labelled synthetic in names and metadata and restricted to delivery research.

## Caveats
- Synthetic flaws are cleaner than natural ones; prior spreads (natural variation between good speakers) are assumptions until estimated from human good takes (`python -m shruti priors`).
- English only; alignment quality drops in heavy noise (10 dB SNR) and the quality gate reports it.
- Misplaced emphasis and mumbling are detected reliably only at high severity; tempo flaws need roughly a 60–80% change.
