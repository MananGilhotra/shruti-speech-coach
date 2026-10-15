# SHRUTI: Contrastive Speech-Delivery Analytics with Temporal Flaw Grounding

*Technical documentation · Multimodal AI Hackathon 2026, Track C · six pages*

## 1. Problem and contributions

Judges of declamation, interpretive reading and debate balance delivery (tone, cadence, volume, pauses) against content. Their scores vary and their feedback is vague. SHRUTI compares a delivery with good deliveries of the **same text**, finds the exact spans where it departs, proves each departure statistically, and explains it with numbers. Contributions:

1. **SHRUTI-Bench**, a contrastive dataset: six public-domain reference speeches with a 10-type × 10-level "bad mirror" (914 renders, 10.5 h, 1,160 flaw events with exact labels). It includes controls that must stay clean, stress conditions, and a human layer collected by instruction-as-label (Flaw Studio).
2. **A population baseline with false-discovery-rate control.** About 450 hypothesis tests per minute of speech, Benjamini–Hochberg at q = 0.05, and a practical-size floor. Flags carry z, p, q and bootstrap 95% intervals on both edges.
3. **Speaker-agnostic, interpretable features.** Pitch in semitones relative to the speaker, loudness relative to the speaker, tempo relative to the speaker's own rate, our own cepstral peak prominence, and spectral tilt and centroid. Silence detection adapts to the noise floor, and hesitations glued to words are split off.
4. **Causal explanation by counterfactual.** Ghost Coach re-delivers one region in the speaker's own voice (PSOLA). Re-analysing the corrected audio shows which single feature, when fixed, clears the flag.
5. **A reproducible system:** an API, a dashboard, a one-command rebuild, golden tests and fingerprints.

## 2. Dataset construction (SHRUTI-Bench)

**Good baselines.** S1 JFK (1961), S2 JFK (1962), S3 FDR (1941), S4 Obama (2009), S5 Eisenhower (1961), S6 Reagan (1987). All are US federal works in the public domain, taken from Wikimedia Commons with SHA-256 sums. The 26–50 s excerpts have their edges snapped to silences. TED talks (CC BY-NC-ND forbids derivatives) and copyrighted speeches were excluded on purpose.

**The bad mirror.** Each render is a pure function of a small JSON recipe and a reference take:

1. One TD-PSOLA pass applies every timing and pitch change.
2. In-place edits apply gain curves and mumbling.
3. Insertions and deletions follow, latest position first: room tone for pauses, the speaker's own vowel stretched into a filler, repeated onsets.
4. Optional voice change and recording condition come last.

Labels are carried through every edit by composed piecewise-linear time maps, which are unit-tested to be exact. Severities are spaced geometrically from Level 1, inside the natural spread ("almost perfect"), to Level 10 (egregious). Two hygiene rules prevent shortcut learning: inserted silence is never digital zero, and every file, controls included, passes through the same resynthesis.

**Layers.**
- **identity:** the reference through the processing chain, unchanged.
- **clean:** tempo ±8%, word-timing jitter 6%, pitch ±2 st, range ±15%, gain ±6 dB, formant ±10%.
- **single:** one flaw.
- **gradient:** a fixed three-flaw bundle at levels 0–10.
- **voice:** large timbre and pitch change only.
- **stress:** pink or white noise at 30/20/10 dB SNR, telephone band, reverberation (RT60 0.5 s), MP3 at 64 kbps, −12 dB gain.

**Splits.** S1–S4 (dev, 606 renders) are used for every design decision. S5–S6 (test, 308 renders) are unseen speakers *and* texts, evaluated once with the frozen configuration (hash `b2f09f8d381c132e`).

**Human layer.** Flaw Studio gives each volunteer a deterministic, rotated assignment: two scripts × (one good take + three instructed flaws). The on-screen instruction is the label, alignment proposes the realised span, and a reviewer accepts, adjusts or rejects it. 20% of takes are double-reviewed for agreement (boundary error, IoU, Cohen's κ). Accepted good takes join the baseline (leave-speaker-out). Consent covers CC BY 4.0 release; voices are never cloned.

## 3. Features and alignment

**Alignment.** wav2vec2-base-960h CTC log-probabilities (30 s chunks with 1 s context) go into our exact CTC Viterbi with blank states and no-skip-on-repeat constraints. It returns word spans and per-character emission times. A greedy CTC transcript against the script gives a word error rate for the quality gate.

**Frame features (10 ms).**
- Two-pass Praat F0 with a speaker-adaptive floor and ceiling (0.75·Q1, 1.75·Q3).
- Intensity, harmonicity and 25 ms STFT energy.
- Spectral tilt: 1–5 kHz vs 0–1 kHz energy.
- Spectral centroid, and MFCC 1–13 from a 40-band mel spectrum.
- CPP, computed as:

C(q) = |F⁻¹{log|F{x·w}|²}|, CPP = max over q ∈ [2.5, 13.3] ms of [C(q) − (aq + b)].

**Speaker normalisation.**
- st(t) = 12·log₂(F0(t)/F̃0_speaker).
- Intensity is taken relative to the speaker's voiced median.
- Each feature's global offset g = medianₙ(xₙ − mₙ) is removed before comparison, so "speaks faster or higher overall" is a style note, not a flaw.

**Word table.** Silent runs (≥ 120 ms; threshold = max of voiced median − 18 dB, or floor + 0.55·(median − floor) in noise) are found globally and assigned to the gap between the two words whose centres enclose them. A pause is the total silence in the gap. Word edges snap to silence edges by at most 80 ms. A word whose span holds a long, steady, flat-pitched first run, or short bursts matching its onset frame-by-frame (MFCC cosine ≥ 0.85 with a ±3-frame lag search), is repaired: the hesitation is moved into the gap. This only happens when the aligner placed fewer than half the word's letters in that first run.

## 4. Detection: population baseline, tests and FDR

**Baseline.** For script k, word w and feature f, the location m is the median over reference takes after removing each reference's offset. The spread is shrunk toward a prior s₀ (empirical Bayes):

s̃² = (ν₀·s₀² + (n−1)·s²) / (ν₀ + n − 1), ν₀ = 30, df = ν₀ + n − 1.

For short words an alignment-noise term is added: s² += (√2·σ_b/d)², with σ_b = 25 ms.

**Test families (≈ 450 tests per take).**

| Family | Statistic |
|---|---|
| Tempo | ℓ = ln(D_obs / θ·D_ref) over 3-word windows inside phrases and over whole inter-pause phrases (articulation time = span − pauses − hesitations, which cancels internal boundary error) |
| Pause | Δ = x − θ·m per gap |
| Loudness | Mean intensity drop over 3 words |
| Clarity | Mean brightness loss: (z_tilt + z_centroid)/2 |
| Monotone | Log pitch-range ratio over 5 words |
| Emphasis | (z_I + z_F0)/√(2+2ρ) on weak or key words |
| Fluency | Fillers and stutters |

Window SDs use correlated averaging with neighbour correlation ρ = 0.3. An empirical null (median and MAD of each family's z) may widen, but never narrow, the null for an unusual recording.

**FDR.** Benjamini–Hochberg at q = 0.05 over all tests of the take: k* = max{i : p₍ᵢ₎ ≤ (i/m)·q}. A flag also needs a practical effect: ≥ 20% tempo change, ≥ 0.35 s extra pause, ≤ 35% of an expected ≥ 0.25 s pause, ≥ 3.5 dB drop, pitch range ≤ 64%, or ≥ 2.5 dB and 1 st emphasis shift.

**Regions.** Surviving tests of a type merge into regions. Conflict rules resolve two cases:
- a "dragged" phrase whose extra time is a detected hesitation is not double-counted;
- an emphasis change inside a flattened or faded stretch is explained by that stretch.

Forty bootstrap replicates jitter every word edge (σ = 15 ms) and resample references when n ≥ 3. They give each edge a 95% interval, floored at the 10 ms frame, and each region a confidence.

## 5. Explanations, rubric and Ghost Coach

**Cards.** Deterministic templates give the headline, explanation with the measured and expected values, fix and evidence table. The math panel prints the actual test, for example z = ℓ/σ = −0.584/0.125 = −4.65, then p and q_BH. No language model is involved.

**Rubric.** Seven dimensions: S_d = max(0, 10 − (60/T)·Σ c(sev) − g_d), with c(1…5) = 0.3, 0.6, 1.0, 1.6, 2.5. Severity is set by |z| bands, T is the speaking time, and a bounded style penalty applies only when overall tempo or pitch range is far outside the reference. The WSDC Style mark is 24 + 0.8 × overall.

**Ghost Coach.** Only the flagged region is changed:
- word durations become ρ_w = clamp(θ·d_ref/d, 0.5, 2);
- pauses are re-set with the recording's own room tone;
- pitch follows the reference contour time-warped onto the speaker's words: F0* = F̃0·2^{[(1−β)st_user + β·st_ref]/12}, β = 0.8;
- loudness is moved to the reference level;
- fillers and stutters are cut.

**Counterfactual check.** The corrected audio is re-analysed. In the Judge Mode demo, fixing only the pause, only the pitch contour, or only the cut clears the corresponding flag. That supports the cause named on the card.

## 6. Results, ablations and limitations

| | Dev (S1–S4, 606 files) | Test (S5–S6, 308 files, once) |
|---|---|---|
| Event F1 at IoU ≥ 0.5 (95% CI) | 0.44 (0.40–0.48) | **0.50 (0.43–0.55)** |
| Precision / recall | 0.57 / 0.36 | **0.81** / 0.36 |
| Median boundary error (start / end) | 14 / 12 ms | 20 / 21 ms |
| Mean IoU of matches | 0.90 | 0.88 |
| False flags per minute: clean / voice / identity controls | 0.18 / 0.09 / 0 | **0 / 0 / 0** |
| False flags per minute under stress conditions (clean files) | 0.82 | 0.55 |
| Spearman ρ, overall score vs severity | −0.94 | −0.95 |

By flaw type (test F1, with L50 = the severity level detected half the time):

| Flaw | Test F1 | L50 |
|---|---|---|
| Filler | 0.88 | 3.5 |
| Long pause | 0.78 | 3.0 |
| Monotone | 0.45 | 8.0 |
| Stutter | 0.44 | 6.6 |
| Volume fade | 0.34 | 7.5 |
| Mumble | 0.25 | – |
| Missing pause | 0.20 | 8.5 |
| Rushed | 0.19 | 10.2 |
| Misplaced emphasis | 0.11 | 10.0 |
| Dragged | 0 | – |

**Robustness (test, flawed files).** F1 is 0.80 under MP3 and reverberation, 0.71 on the telephone band, and 0.20 at 10 dB SNR, where alignment itself degrades.

**Ablations on dev.**
- Without the noise-adaptive silence threshold, false flags under stress were 3.2 per minute (vs 0.82).
- A sharpening empirical null raised recall from 0.36 to 0.44 but let false flags into clean takes (0.72 per minute), so the null is widen-only.
- q = 0.10 or 0.20 changes F1 by less than its CI (0.45), so the strictest q was kept.
- The contrastive delivery encoder (conv + BiGRU, margin contrastive loss plus a type head; leave-one-script-out: train S1–S3, test S4) gave F1 0.359 against 0.363 for statistics alone, so it ships disabled.

**Limitations.**
- The rushed/dragged, emphasis and mumble thresholds depend on the prior spread of good speakers, which is assumed until human good takes estimate it (`python -m shruti priors`).
- Synthetic flaws are cleaner than natural ones.
- English only, and six male American references (the human layer adds Indian English voices and both genders).
- Alignment fails in heavy noise.
- Known v1.1 issue: the aligner can place a short function word inside a long pause, which clips the measured pause end (IoU still ≥ 0.5 in our test). The planned fix re-places words whose span is mostly silence; it was not applied after the freeze so the reported numbers stay valid.
- Delivery only, not argument quality.
- "Good" means close to good readings of the same text, so a deliberate stylistic choice can be flagged.

The adjudicator study (`python -m shruti study-build`, `/study`, `python -m shruti panel`) is built to measure agreement with human judges: ICC, leave-one-judge-out comparison, and localisation error. Its results will be added when collected.

**References.**
- Benjamini & Hochberg 1995.
- Smyth 2004 (moderated statistics).
- Efron 2004 (empirical null).
- Hillenbrand et al. 1994 (CPP).
- De Looze & Hirst 2008.
- Moulines & Charpentier 1990 (PSOLA).
- Jadoul et al. 2018 (Parselmouth).
- Baevski et al. 2020 (wav2vec 2.0).
- Hadsell et al. 2006 (contrastive loss).
- Shrout & Fleiss 1979 (ICC).
- Gebru et al. 2021 (datasheets).
