# SHRUTI-Bench — datasheet

Following Gebru et al., *Datasheets for Datasets* (CACM 2021). Version 1.0 (synthetic layers) — human layer collection in progress through Flaw Studio.

## Motivation
- **Why?** No public dataset pairs good deliveries of a text with a graded spectrum of flawed deliveries of the *same* text, with time-stamped flaw labels. Track C of the Multimodal AI Hackathon 2026 asks for exactly that.
- **By whom?** The SHRUTI team, for the IIT Mandi Multimodal AI Hackathon 2026 (Track C).

## Composition
| Layer | What it contains | dev (S1–S4) | test (S5–S6) |
|---|---|---|---|
| original | The six reference excerpts (public-domain presidential speeches) | 4 | 2 |
| identity | The original passed through the same PSOLA chain with no change (processing-artefact control) | 4 | 2 |
| clean | Natural-variation nuisance only (tempo ±8%, word timing jitter 6%, pitch ±2 st, range ±15%, gain ±6 dB, formant ±10%) — **0 flaws** | 24 | 12 |
| single | One flaw type at one of 10 severity levels (10 types × 10 levels) | 390 | 200 |
| gradient | A fixed bundle of 3 flaws swept from level 0 (clean) to level 10 | 88 | 44 |
| voice | Large timbre / pitch change only (a different "speaker") — **0 flaws** | 16 | 8 |
| stress | 7 recording conditions × (clean + 2 flawed) | 84 | 42 |
| **total renders** |  | **606** | **308** |

914 renders, 10.5 hours of audio, 1,160 labelled flaw events: filler 221, rushed 118, long pause 117, monotone 115, volume fade 109, dragged 105, mumble 100, stutter 99, misplaced emphasis 90, missing pause 86.

### Reference recordings
| ID | Speaker | Year | Excerpt | Duration | Words |
|---|---|---|---|---|---|
| S1 | John F. Kennedy | 1961 | Inaugural Address, "Let the word go forth…" | 46.7 s | 80 |
| S2 | John F. Kennedy | 1962 | Rice University, "We choose to go to the Moon…" | 26.6 s | 67 |
| S3 | Franklin D. Roosevelt | 1941 | Address to Congress, "a date which will live in infamy" | 49.6 s | 66 |
| S4 | Barack Obama | 2009 | Inaugural Address, "everywhere we look, there is work to be done" | 46.0 s | 128 |
| S5 | Dwight D. Eisenhower | 1961 | Farewell Address, "the military-industrial complex" | 44.5 s | 90 |
| S6 | Ronald Reagan | 1987 | Brandenburg Gate, "come here to this gate" | 31.4 s | 54 |

All are works of the US federal government (public domain, 17 U.S.C. §105), downloaded from Wikimedia Commons; file pages, download URLs and SHA-256 sums are in `data/sources.csv`. Excerpt edges are snapped to silences so no word is clipped and no applause leaks in.

### Flaw taxonomy and severity ladder
Ten flaw types, each with a physical parameter spaced geometrically from Level 1 (≈ the spread of good deliveries; "almost perfect") to Level 10 (egregious):

| Flaw | Rubric dimension | Injection | Level 1 → Level 10 |
|---|---|---|---|
| rushed | pacing | PSOLA time-compression of the phrase (pauses kept) | rate × 1.08 → × 1.8 |
| dragged | pacing | PSOLA time-stretch of the phrase (pauses kept) | duration × 1.10 → × 2.0 |
| long_pause | pausing | the recording's own room tone inserted after a word | +0.30 s → +3.0 s |
| missing_pause | pausing | the middle of an existing pause removed with a crossfade | keep 80% → 2% |
| monotone | intonation | PSOLA pitch-range compression over the phrase | range × 0.8 → × 0.1 |
| volume_fade | projection | gain ramp reaching full depth after 20% of the phrase | −2 dB → −18 dB |
| mumble | clarity | low-pass + −3 dB + band-limited breath noise | cut-off 6 kHz → 1.5 kHz |
| filler | fluency | a hesitation vowel made from the speaker's own voice (PSOLA, flat falling pitch) | 1 × 0.2 s → 4 × 0.8 s |
| stutter | fluency | the word's onset repeated with short room-tone gaps | 1 → 3 repeats |
| misplaced_emphasis | emphasis | +g dB and +0.6·g st on a function word, key word flattened | g = 1 → 10 dB |

### Labels
`data/bench/labels.jsonl`, one JSON object per render: `render_id, script_id, split, layer, audio, duration_s, sha256` and `labels[]` with `flaw_id, type, level, param, words [i, j], t_start, t_end` (rendered timeline) and `t_start_source, t_end_source` (original timeline). Times are carried through every edit with explicit piecewise-linear time maps, so they are exact (unit-tested). Label span conventions: phrase flaws = first word start → last word end; long pause = the whole silence between the two words; missing pause = ±0.25 s around the junction; filler = the inserted sound; stutter = first inserted onset → start of the word; misplaced emphasis = the stressed function word.

### Splits
Dev = S1–S4 (all tuning happens here). Test = S5–S6: unseen speakers *and* unseen texts, evaluated once on the commit tagged `v1.0-frozen`. Human takes (Flaw Studio) are split by speaker; a speaker's own takes never enter the baseline used to judge them.

## Collection process
Synthetic layers are produced by `shruti dataset` from seeded recipes (`data/bench/recipes.jsonl`): a render is a pure function of (recipe, reference take). Injection hygiene: inserted silence is room tone, never digital zero; edits use 10 ms raised-cosine crossfades; every synthetic file (including controls) passes through the same PSOLA resynthesis, so processing artefacts never signal a flaw. Human layers follow `studio/protocol.md` with informed consent (`studio/consent.md`).

## Preprocessing
16 kHz mono, DC removed, peak −1 dBFS for the references. No denoising (it would change the features under test).

## Uses
Intended: research and teaching on speech-delivery feedback; benchmarking temporal flaw localisation. Not intended: judging real people's worth or ability in high-stakes settings; speaker identification; creating misleading audio of public figures.

## Distribution and maintenance
Recipes, labels, sources and the six references are in the GitHub repository; renders regenerate bit-exactly (`make dataset && make verify`). The human layer will be released under CC BY 4.0 on Hugging Face with a Zenodo DOI at the 12 October 2026 freeze. Manipulated audio of public figures is labelled synthetic in its file name and metadata.

## Known limitations
Synthetic flaws are cleaner than natural ones; the natural-variation nuisance is a model, not a measurement of real good speakers (the human layer exists to measure it); six speakers, all American male politicians speaking English, in the reference set — the human layer adds Indian English voices and both genders.
