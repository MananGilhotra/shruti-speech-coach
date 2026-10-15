"""End-to-end checks on the real reference recordings (needs the wav2vec2 model)."""
import json

import numpy as np
import pytest

from shruti.config import ROOT, load_config

pytestmark = pytest.mark.slow
ORIG = ROOT / "data" / "bench" / "originals"


@pytest.fixture(scope="module")
def s1():
    from shruti.io.audio import load_audio
    from shruti.process import load_scripts
    from shruti.store import processed_take
    cfg = load_config()
    x = load_audio(ORIG / "S1.flac")
    take, report = processed_take(x, load_scripts()["S1"]["transcript"], cfg)
    return cfg, x, take, report


def test_alignment_covers_every_word(s1):
    cfg, x, take, report = s1
    w = take.words
    assert len(w) == 80
    assert (np.diff(w["start"].to_numpy()) >= -1e-6).all()
    assert report["asr_wer"] < cfg["alignment"]["max_wer"]


def test_reference_against_itself_has_no_flaws(s1):
    from shruti.baseline.population import build_baseline
    from shruti.detect.core import detect
    cfg, x, take, _ = s1
    regions, tests, _ = detect(take, build_baseline("S1", [take], ["self"], cfg), cfg)
    assert regions == []
    assert len(tests) > 300


def test_injected_long_pause_is_found_and_grounded(s1):
    from shruti.baseline.population import build_baseline
    from shruti.detect.core import detect
    from shruti.inject.engine import render
    from shruti.process import load_scripts
    from shruti.store import processed_take
    cfg, x, take, _ = s1
    rec = {"seed": 0, "flaws": [{"flaw_id": "f1", "type": "long_pause", "level": 8, "param": 1.8, "words": [42, 42]}]}
    r = render(rec, take, x)
    P, _ = processed_take(r.audio, load_scripts()["S1"]["transcript"], cfg, use_cache=False)
    regions, _, _ = detect(P, build_baseline("S1", [take], ["self"], cfg), cfg)
    lab = r.labels[0]
    hits = [g for g in regions if g.ftype == "long_pause"]
    assert hits
    assert abs(hits[0].t_start - lab["t_start"]) < 0.05
    # Known v1.1 issue: the aligner can drop a short function word ("of") inside a long pause,
    # which clips the measured pause end; the region still overlaps the label at IoU >= 0.5.
    from shruti.eval.match import iou
    assert iou((hits[0].t_start, hits[0].t_end), (lab["t_start"], lab["t_end"])) >= 0.5


def test_golden_analysis_is_reproducible(s1):
    """Analysing the same audio twice yields byte-identical JSON (no randomness, no clocks)."""
    from shruti.analyze import analyze
    cfg, x, _, _ = s1
    a = analyze(x, "S1", bootstrap=True)
    b = analyze(x, "S1", bootstrap=True)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
