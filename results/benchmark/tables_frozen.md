### dev split (606 files)

Event F1 0.44 (95% CI 0.40–0.48), precision 0.57, recall 0.36 at temporal IoU ≥ 0.5; macro F1 0.36. Boundary error median 13.90 ms (start), 11.50 ms (end); mean IoU of matches 0.90.

| Flaw | Precision | Recall | F1 | TP | FP | FN | L50 (level detected half the time) |
|---|---|---|---|---|---|---|---|
| Rushed | 0.11 | 0.03 | 0.05 | 2 | 16 | 63 | > 10 |
| Dragged | 0.07 | 0.03 | 0.04 | 2 | 27 | 69 | 9.9 |
| Long pause | 0.69 | 0.73 | 0.71 | 54 | 24 | 20 | 3.5 |
| Missing pause | 0.15 | 0.30 | 0.20 | 16 | 91 | 37 | 7.6 |
| Monotone | 1.00 | 0.30 | 0.46 | 19 | 0 | 44 | 7.6 |
| Volume fade | 0.95 | 0.41 | 0.58 | 36 | 2 | 51 | 6.8 |
| Mumble | 0.67 | 0.10 | 0.17 | 8 | 4 | 72 | 9.7 |
| Filler | 0.79 | 0.71 | 0.75 | 100 | 26 | 40 | 3.5 |
| Stutter | 0.67 | 0.45 | 0.54 | 34 | 17 | 42 | 6.5 |
| Misplaced emphasis | 1.00 | 0.04 | 0.07 | 2 | 0 | 55 | > 10 |

| Control layer (no flaw present) | Files | Flags | Minutes | False flags / min | Files with any flag |
|---|---|---|---|---|---|
| clean | 24 | 3 | 16.56 | 0.18 | 3 |
| gradient-L0 | 8 | 1 | 5.59 | 0.18 | 1 |
| identity | 4 | 0 | 2.81 | 0.00 | 0 |
| stress-clean | 28 | 16 | 19.61 | 0.82 | 5 |
| voice | 16 | 1 | 11.26 | 0.09 | 1 |

| Recording condition (flawed files) | Precision | Recall | F1 |
|---|---|---|---|
| gain_-12db | 0.78 | 0.58 | 0.67 |
| mp3_64k | 0.54 | 0.50 | 0.52 |
| noise_10db | 0.25 | 0.70 | 0.37 |
| noise_20db | 0.43 | 0.30 | 0.35 |
| noise_30db | 0.70 | 0.70 | 0.70 |
| phone | 0.80 | 0.40 | 0.53 |
| reverb | 0.80 | 0.40 | 0.53 |

Severity monotonicity: median Spearman ρ between overall score and severity level over 8 gradient series = -0.94.

### test split (308 files)

Event F1 0.50 (95% CI 0.43–0.55), precision 0.81, recall 0.36 at temporal IoU ≥ 0.5; macro F1 0.41. Boundary error median 19.80 ms (start), 20.60 ms (end); mean IoU of matches 0.88.

| Flaw | Precision | Recall | F1 | TP | FP | FN | L50 (level detected half the time) |
|---|---|---|---|---|---|---|---|
| Rushed | 0.60 | 0.11 | 0.19 | 6 | 4 | 47 | > 10 |
| Dragged | 0.00 | 0.00 | – | 0 | 5 | 34 | > 10 |
| Long pause | 0.86 | 0.72 | 0.78 | 31 | 5 | 12 | 3.0 |
| Missing pause | 0.57 | 0.12 | 0.20 | 4 | 3 | 29 | 8.5 |
| Monotone | 1.00 | 0.29 | 0.45 | 15 | 0 | 37 | 8.0 |
| Volume fade | 0.71 | 0.23 | 0.34 | 5 | 2 | 17 | 7.5 |
| Mumble | 0.33 | 0.20 | 0.25 | 4 | 8 | 16 | > 10 |
| Filler | 0.93 | 0.83 | 0.88 | 67 | 5 | 14 | 3.5 |
| Stutter | 0.78 | 0.30 | 0.44 | 7 | 2 | 16 | 6.6 |
| Misplaced emphasis | 1.00 | 0.06 | 0.11 | 2 | 0 | 31 | 10.0 |

| Control layer (no flaw present) | Files | Flags | Minutes | False flags / min | Files with any flag |
|---|---|---|---|---|---|
| clean | 12 | 0 | 7.62 | 0.00 | 0 |
| gradient-L0 | 4 | 0 | 2.59 | 0.00 | 0 |
| identity | 2 | 0 | 1.27 | 0.00 | 0 |
| stress-clean | 14 | 5 | 9.03 | 0.55 | 4 |
| voice | 8 | 0 | 5.06 | 0.00 | 0 |

| Recording condition (flawed files) | Precision | Recall | F1 |
|---|---|---|---|
| gain_-12db | 0.00 | 0.00 | – |
| mp3_64k | 1.00 | 0.67 | 0.80 |
| noise_10db | 0.25 | 0.17 | 0.20 |
| noise_20db | 0.50 | 0.50 | 0.50 |
| noise_30db | 1.00 | 0.25 | 0.40 |
| phone | 0.62 | 0.83 | 0.71 |
| reverb | 1.00 | 0.67 | 0.80 |

Severity monotonicity: median Spearman ρ between overall score and severity level over 4 gradient series = -0.95.
